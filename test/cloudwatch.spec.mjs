import lib from '../dist/mjs/lib/cloudwatch.js';
import sinon from 'sinon';
import should from 'should';
import {LogStream} from '@aws-sdk/client-cloudwatch-logs';

const ArgumentFactory = {
    upload(args = {}) {
        return {
            logGroupName: 'group',
            logStreamName: 'stream',
            retentionInDays: 0,
            options: {
                ensureGroupPresent: true,
            },
            cb: () => {},
            ...args,
        };
    },
    getToken(args = {}) {
        return ArgumentFactory.upload(args);
    },
    getStream(args = {}) {
        return {logGroupName: 'group', logStreamName: 'stream', ...args};
    },
    putRetentionPolicy(args = {}) {
        return {logGroupName: 'group', retentionInDays: 1, ...args};
    },
    ensureGroupPresent(args = {}) {
        return {logGroupName: 'group', retentionInDays: 0, ...args};
    },
    submitWithAnotherToken(args = {}) {
        return {...ArgumentFactory.upload(args), payload: {}, ...args};
    },
};

describe('cloudwatch-integration', function () {
    describe('upload', function () {
        var aws = {};

        beforeEach(function () {
            aws.putLogEvents = sinon.stub().yields();
            aws.putRetentionPolicy = sinon.stub().returns();
            lib.init(aws);

            sinon.stub(lib, '_getToken').yieldsTo('cb', null, 'token');
            sinon.stub(lib, '_submitWithAnotherToken').yieldsTo('cb');
            sinon.stub(console, 'error');
        });

        afterEach(function () {
            lib._getToken.restore();
            lib._submitWithAnotherToken.restore();
            console.error.restore();
            lib._nextToken = {};
        });

        it('ignores upload calls if putLogEvents already in progress', function (done) {
            (1).should.equal(1);

            const events = [{message: 'test message', timestamp: new Date().toISOString()}];
            aws.putLogEvents.onFirstCall().returns(); // Don't call call back to simulate ongoing request.
            aws.putLogEvents.onSecondCall().yields();
            lib.upload({
                ...ArgumentFactory.upload(),
                aws,
                logEvents: events,
            });
            lib.upload({
                ...ArgumentFactory.upload({
                    cb: function () {
                        // The second upload call should get ignored
                        aws.putLogEvents.calledOnce.should.equal(true);
                        lib._postingEvents['stream'] = false; // reset
                        done();
                    },
                }),
                aws,
                logEvents: events,
            });
        });

        it('ignores upload calls if getToken already in progress', function (done) {
            const events = [{message: 'test message', timestamp: new Date().toISOString()}];
            lib._getToken.onFirstCall().returns(); // Don't call call back to simulate ongoing token request.
            lib._getToken.onSecondCall().yieldsTo('cb', null, 'token');
            lib.upload({
                ...ArgumentFactory.upload(),
                aws,
                logEvents: events,
            });
            lib.upload({
                ...ArgumentFactory.upload(),
                aws,
                logEvents: events,
                cb: function () {
                    // The second upload call should get ignored
                    lib._getToken.calledOnce.should.equal(true);
                    lib._postingEvents['stream'] = false; // reset
                    done();
                },
            });
        });

        it('not ignores upload calls if getToken already in progress for another stream', function (done) {
            const events = [{message: 'test message', timestamp: new Date().toISOString()}];
            lib._getToken.onFirstCall().returns(); // Don't call call back to simulate ongoing token request.
            lib._getToken.onSecondCall().yieldsTo('cb', null, 'token');
            lib.upload({
                ...ArgumentFactory.upload(),
                aws,
                logEvents: events,
                logStreamName: 'stream1',
            });

            lib.upload({
                ...ArgumentFactory.upload(),
                aws,
                logEvents: events,
                logStreamName: 'stream2',
                cb: function () {
                    lib._getToken.calledTwice.should.equal(true);
                    done();
                },
            });

            lib._postingEvents['stream1'] = false; // reset
            lib._postingEvents['stream2'] = false; // reset
        });

        it('truncates very large messages and alerts the error handler', function (done) {
            var BIG_MSG_LEN = 300000;
            const events = [{message: new Array(BIG_MSG_LEN).join('A'), timestamp: new Date().toISOString()}];
            var errCalled = false;
            lib.upload({
                ...ArgumentFactory.upload(),
                aws,
                logEvents: events,
                cb: function (err) {
                    if (err) {
                        errCalled = true;
                        return;
                    }
                    errCalled.should.equal(true);
                    aws.putLogEvents.calledOnce.should.equal(true);
                    aws.putLogEvents.args[0][0].logEvents[0].message.length.should.be.lessThan(BIG_MSG_LEN); // Truncated
                    done();
                },
            });
        });

        it('batches messages so as not to exceed CW limits', function (done) {
            var BIG_MSG_LEN = 250000; // under single limit but a few of these will exceed the batch limit
            var bigMessage = new Array(BIG_MSG_LEN).join(' ');
            const events = [
                {message: bigMessage, timestamp: new Date().toISOString()},
                {message: bigMessage, timestamp: new Date().toISOString()},
                {message: bigMessage, timestamp: new Date().toISOString()},
                {message: bigMessage, timestamp: new Date().toISOString()},
                {message: bigMessage, timestamp: new Date().toISOString()},
            ];
            lib.upload({
                ...ArgumentFactory.upload(),
                aws,
                logEvents: events,
                cb: function (err) {
                    aws.putLogEvents.calledOnce.should.equal(true);
                    aws.putLogEvents.args[0][0].logEvents.length.should.equal(3); // First Batch
                    // Now, finish.
                    lib.upload({
                        ...ArgumentFactory.upload(),
                        aws,
                        logEvents: events,
                        cb: function (err) {
                            aws.putLogEvents.args[1][0].logEvents.length.should.equal(2); // Second Batch
                            done();
                        },
                    });
                },
            });
        });

        it('puts log events', function (done) {
            lib.upload({
                ...ArgumentFactory.upload(),
                logEvents: Array(20),
                aws,

                cb: function () {
                    aws.putLogEvents.calledOnce.should.equal(true);
                    aws.putLogEvents.args[0][0].logGroupName.should.equal('group');
                    aws.putLogEvents.args[0][0].logStreamName.should.equal('stream');
                    aws.putLogEvents.args[0][0].logEvents.length.should.equal(20);
                    aws.putLogEvents.args[0][0].sequenceToken.should.equal('token');
                    done();
                },
            });
        });

        it('adds token to the payload only if it exists', function (done) {
            lib._getToken.yieldsTo('cb', null);
            lib.upload({
                ...ArgumentFactory.upload(),
                logEvents: Array(20),
                aws,

                cb: function () {
                    aws.putLogEvents.calledOnce.should.equal(true);
                    aws.putLogEvents.args[0][0].logGroupName.should.equal('group');
                    aws.putLogEvents.args[0][0].logStreamName.should.equal('stream');
                    aws.putLogEvents.args[0][0].logEvents.length.should.equal(20);
                    should.not.exist(aws.putLogEvents.args[0][0].sequenceToken);
                    done();
                },
            });
        });

        it('does not put if events are empty', function (done) {
            lib.upload({
                ...ArgumentFactory.upload(),
                aws,
                logEvents: [],
                cb: function () {
                    aws.putLogEvents.called.should.equal(false);
                    done();
                },
            });
        });

        it('errors if getting the token errors', function (done) {
            lib._getToken.yieldsTo('cb', 'err');
            lib.upload({
                ...ArgumentFactory.upload(),
                aws,
                logEvents: Array(20),

                cb: function (err) {
                    err.should.equal('err');
                    done();
                },
            });
        });

        it('errors if putting log events errors', function (done) {
            aws.putLogEvents.callsArgWith(1, 'err');

            lib.upload({
                ...ArgumentFactory.upload(),
                aws,
                logEvents: Array(20),

                cb: function (err) {
                    err.should.equal('err');
                    done();
                },
            });
        });

        it('gets another token if InvalidSequenceTokenException', function (done) {
            aws.putLogEvents.callsArgWith(1, {name: 'InvalidSequenceTokenException'});
            lib.upload({
                ...ArgumentFactory.upload(),
                aws,
                logEvents: Array(20),
                cb: function (err) {
                    lib._submitWithAnotherToken.calledOnce.should.equal(true);
                    done();
                },
            });
        });

        it('gets another token if ResourceNotFoundException', function (done) {
            aws.putLogEvents.callsArgWith(1, {name: 'InvalidSequenceTokenException'});
            lib.upload({
                ...ArgumentFactory.upload(),
                aws,
                logEvents: Array(20),
                cb: function (err) {
                    lib._submitWithAnotherToken.calledOnce.should.equal(true);
                    done();
                },
            });
        });

        it('nextToken is saved when available', function (done) {
            var nextSequenceToken = 'abc123';
            aws.putLogEvents.callsArgWith(1, null, {nextSequenceToken: nextSequenceToken});
            lib.upload({
                ...ArgumentFactory.upload(),
                aws,

                logEvents: Array(20),

                cb: function () {
                    sinon.assert.match(lib._nextToken, {'group:stream': nextSequenceToken});
                    done();
                },
            });
        });
    });

    describe('putRetentionPolicy', function () {
        var aws = {};
        beforeEach(function () {
            aws.putRetentionPolicy = sinon.stub().returns();
            lib.init(aws);
        });
        it('only logs retention policy if given > 0', function () {
            lib._putRetentionPolicy({
                ...ArgumentFactory.putRetentionPolicy({logEvents: 'group', retentionInDays: 1}),
                aws,
            });
            aws.putRetentionPolicy.calledOnce.should.equal(true);
        });
        it('doesnt logs retention policy if given = 0', function () {
            lib._putRetentionPolicy({
                ...ArgumentFactory.putRetentionPolicy({logEvents: 'group', retentionInDays: 0}),
                aws,
            });
            aws.putRetentionPolicy.calledOnce.should.equal(false);
        });
    });

    describe('getToken', function () {
        var aws;
        var ensureGroupPresent;
        var getStream;

        const streamResponse = {
            arn: 'fakearn',
            creationTime: Date.now(),
            lastIngestionTime: Date.now(),
            logStreamName: 'logStreamName',
        };

        beforeEach(function () {
            ensureGroupPresent = sinon.stub(lib, '_ensureGroupPresent');
            getStream = sinon.stub(lib, '_getStream');
            lib.init(aws);
        });

        afterEach(function () {
            lib._ensureGroupPresent.restore();
            lib._getStream.restore();
        });

        it('ensures group and stream are present if no nextToken for group/stream', function (done) {
            ensureGroupPresent.resolves(true);
            getStream.resolves(streamResponse);

            lib._getToken({
                ...ArgumentFactory.getToken(),
                aws,
                options: {
                    ensureGroupPresent: true,
                },
                cb: function () {
                    ensureGroupPresent.calledOnce.should.equal(true);
                    getStream.calledOnce.should.equal(true);
                    done();
                },
            });
        });

        it('yields token when group and stream are present', function (done) {
            ensureGroupPresent.resolves(true);
            getStream.resolves({...streamResponse, uploadSequenceToken: 'token'});
            lib._getToken({
                ...ArgumentFactory.getToken(),
                aws,
                options: {
                    ensureGroupPresent: true,
                },
                cb: function (err, token) {
                    should.not.exist(err);
                    token.should.equal('token');
                    done();
                },
            });
        });

        it('errors when ensuring group errors', function (done) {
            ensureGroupPresent.rejects('err');

            lib._getToken({
                ...ArgumentFactory.getToken(),
                aws,
                cb: function (err) {
                    err.name.should.equal('err');
                    done();
                },
            });
        });

        it('errors when ensuring stream errors', function (done) {
            ensureGroupPresent.resolves(true);
            getStream.rejects('err');

            lib._getToken({
                ...ArgumentFactory.getToken(),
                aws,
                cb: function (err) {
                    err.name.should.equal('err');
                    done();
                },
            });
        });

        it('does not ensure group and stream are present if nextToken for group/stream', function (done) {
            lib._nextToken = {'group:stream': 'test123'};
            lib._getToken({
                ...ArgumentFactory.getToken(),
                aws,
                cb: function () {
                    ensureGroupPresent.notCalled.should.equal(true);
                    getStream.notCalled.should.equal(true);
                    done();
                },
            });
        });
    });

    describe('ensureGroupPresent', function () {
        var aws;
        var putRetentionPolicy;

        beforeEach(function () {
            aws = {
                describeLogStreams: async (params) => {
                    return new Promise((resolve, reject) => resolve({}));
                },
            };
            putRetentionPolicy = sinon.stub(lib, '_putRetentionPolicy');
            lib.init(aws);
        });

        afterEach(function () {
            putRetentionPolicy.restore();
        });

        it('makes sure that a group is present', async () => {
            putRetentionPolicy.resolves();
            const result = await lib._ensureGroupPresent({
                ...ArgumentFactory.ensureGroupPresent(),
            });
            result.should.equal(true);
            putRetentionPolicy.calledWith({...ArgumentFactory.ensureGroupPresent()}).should.equal(true);
        });

        it('creates a group if it is not present', async () => {
            var err = {name: 'ResourceNotFoundException'};
            aws.describeLogStreams = sinon.stub().rejects(err);
            aws.createLogGroup = sinon.stub().resolves(true);
            putRetentionPolicy.resolves();

            const isPresent = await lib._ensureGroupPresent({
                ...ArgumentFactory.ensureGroupPresent(),
            });

            putRetentionPolicy.calledWith({logGroupName: 'group', retentionInDays: 0}).should.equal(true);
            isPresent.should.equal(true);
        });

        it('errors if looking for a group errors', (done) => {
            aws.describeLogStreams = sinon.stub().rejects('err');

            lib._ensureGroupPresent({
                ...ArgumentFactory.ensureGroupPresent(),
                aws,
            }).catch((e) => {
                e.name.should.equal('err');
                done();
            });
        });

        it('errors if creating a group errors', function (done) {
            var err = {name: 'ResourceNotFoundException'};
            putRetentionPolicy.resolves();
            aws.describeLogStreams = sinon.stub().rejects(err);
            aws.createLogGroup = sinon.stub().rejects('err');

            lib._ensureGroupPresent({
                ...ArgumentFactory.ensureGroupPresent(),
                aws,
            })
                .then((res) => console.log({res}))
                .catch((err) => {
                    err.name.should.equal('err');
                    done();
                });
        });
    });

    describe('getStream', function () {
        var aws;

        beforeEach(function () {
            aws = {
                describeLogStreams: (params) => {
                    return new Promise((resolve) =>
                        resolve({
                            logStreams: [
                                {
                                    logStreamName: 'stream',
                                },
                                {
                                    logStreamName: 'another-stream',
                                },
                            ],
                        })
                    );
                },
            };
            lib.init(aws);
        });

        it('yields the stream we want', async () => {
            const stream = await lib._getStream({
                aws,
                ...ArgumentFactory.getStream(),
            });
            stream.logStreamName.should.equal('stream');
        });

        it('errors if getting streams errors', function (done) {
            aws.describeLogStreams = sinon.stub().rejects('err');

            lib._getStream({
                aws,
                ...ArgumentFactory.getStream(),
            }).catch((err) => {
                err.name.should.equal('err');
                done();
            });
        });

        it('errors if creating stream errors', function (done) {
            aws.describeLogStreams = sinon.stub().resolves([]);
            aws.createLogStream = () => new Promise((resolve, reject) => reject('err'));

            lib._getStream({
                aws,
                ...ArgumentFactory.getStream(),
            }).catch((err) => {
                err.should.equal('err');
                done();
            });
        });

        it('ignores in progress error (aborted)', function (done) {
            aws.describeLogStreams = sinon
                .stub()
                .onCall(0)
                .resolves([])
                .onCall(1)
                .resolves({
                    logStreams: [
                        {
                            logStreamName: 'stream',
                        },
                        {
                            logStreamName: 'another-stream',
                        },
                    ],
                });

            var err = {name: 'OperationAbortedException'};
            aws.createLogStream = sinon.stub().rejects(err);

            lib._getStream({
                aws,
                ...ArgumentFactory.getStream(),
            }).then((res) => {
                res.logStreamName.should.equal('stream');
                done();
            });
        });

        it('ignores in progress error (already exist)', function (done) {
            aws.describeLogStreams = sinon.stub();
            aws.describeLogStreams
                .onCall(0)
                .resolves([])
                .onCall(1)
                .resolves({
                    logStreams: [
                        {
                            logStreamName: 'stream',
                        },
                        {
                            logStreamName: 'another-stream',
                        },
                    ],
                });
            var err = {name: 'ResourceAlreadyExistsException'};
            aws.createLogStream = sinon.stub().rejects(err);

            lib._getStream({
                aws,
                ...ArgumentFactory.getStream(),
            }).then((stream) => {
                stream.logStreamName.should.equal('stream');
                done();
            });
        });
    });

    describe('ignoreInProgress', function () {
        it('ignores a OperationAbortedException', function () {
            var err = {name: 'OperationAbortedException'};
            lib._ignoreInProgress(err).should.equal(true);
        });

        it('ignores a ResourceAlreadyExistsException', function () {
            var err = {name: 'ResourceAlreadyExistsException'};
            lib._ignoreInProgress(err).should.equal(true);
        });

        it('does not ignore any other error', function () {
            var err = {name: 'BoatTooLittleException'};
            lib._ignoreInProgress(err).should.equal(false);
            lib._ignoreInProgress({name: 'otherErr'}).should.equal(false);
        });
    });

    describe('submitWithAnotherToken', function () {
        var aws = {};

        beforeEach(function () {
            aws.putLogEvents = sinon.stub().yields();
            lib.init(aws);
            sinon.stub(lib, '_getToken').yieldsTo('cb', null, 'new-token');
            sinon.stub(console, 'error');
        });

        afterEach(function () {
            lib._getToken.restore();
            console.error.restore();
        });

        it('gets a token then resubmits', function (done) {
            lib._submitWithAnotherToken({
                aws,
                ...ArgumentFactory.submitWithAnotherToken(),
                cb: function () {
                    aws.putLogEvents.calledOnce.should.equal(true);
                    aws.putLogEvents.args[0][0].sequenceToken.should.equal('new-token');
                    done();
                },
            });
        });
    });
});
