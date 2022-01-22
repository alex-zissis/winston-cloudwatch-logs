import lib from '../dist/mjs/lib/cloudwatch.js';
import sinon from 'sinon';
import should from 'should';

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
            sinon.stub(lib, 'getToken').yieldsTo('cb', null, 'token');
            sinon.stub(lib, 'submitWithAnotherToken').yieldsTo('cb');
            sinon.stub(console, 'error');
        });

        afterEach(function () {
            lib.getToken.restore();
            lib.submitWithAnotherToken.restore();
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
            lib.getToken.onFirstCall().returns(); // Don't call call back to simulate ongoing token request.
            lib.getToken.onSecondCall().yieldsTo('cb', null, 'token');
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
                    lib.getToken.calledOnce.should.equal(true);
                    lib._postingEvents['stream'] = false; // reset
                    done();
                },
            });
        });

        it('not ignores upload calls if getToken already in progress for another stream', function (done) {
            const events = [{message: 'test message', timestamp: new Date().toISOString()}];
            lib.getToken.onFirstCall().returns(); // Don't call call back to simulate ongoing token request.
            lib.getToken.onSecondCall().yieldsTo('cb', null, 'token');
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
                    lib.getToken.calledTwice.should.equal(true);
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
            lib.getToken.yieldsTo('cb', null);
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
            lib.getToken.yieldsTo('cb', 'err');
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
                    lib.submitWithAnotherToken.calledOnce.should.equal(true);
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
                    lib.submitWithAnotherToken.calledOnce.should.equal(true);
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
        });
        it('only logs retention policy if given > 0', function () {
            lib.putRetentionPolicy({
                ...ArgumentFactory.putRetentionPolicy({logEvents: 'group', retentionInDays: 1}),
                aws,
            });
            aws.putRetentionPolicy.calledOnce.should.equal(true);
        });
        it('doesnt logs retention policy if given = 0', function () {
            lib.putRetentionPolicy({
                ...ArgumentFactory.putRetentionPolicy({logEvents: 'group', retentionInDays: 0}),
                aws,
            });
            aws.putRetentionPolicy.calledOnce.should.equal(false);
        });
    });

    describe('getToken', function () {
        var aws;

        beforeEach(function () {
            sinon.stub(lib, 'ensureGroupPresent').callsArgWith(1);
            sinon.stub(lib, 'getStream').callsArgWith(1);
        });

        afterEach(function () {
            lib.ensureGroupPresent.restore();
            lib.getStream.restore();
        });

        it('ensures group and stream are present if no nextToken for group/stream', function (done) {
            lib.getToken({
                ...ArgumentFactory.getToken(),
                aws,
                options: {
                    ensureGroupPresent: true,
                },
                cb: function () {
                    lib.ensureGroupPresent.calledOnce.should.equal(true);
                    lib.getStream.calledOnce.should.equal(true);
                    done();
                },
            });
        });

        it('yields token when group and stream are present', function (done) {
            lib.ensureGroupPresent.callsArgWith(1, null, true);
            lib.getStream.callsArgWith(1, null, {
                uploadSequenceToken: 'token',
            });
            lib.getToken({
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
            lib.ensureGroupPresent.callsArgWith(1, 'err');
            lib.getToken({
                ...ArgumentFactory.getToken(),
                aws,
                cb: function (err) {
                    err.should.equal('err');
                    done();
                },
            });
        });

        it('errors when ensuring stream errors', function (done) {
            lib.getStream.callsArgWith(1, 'err');
            lib.getToken({
                ...ArgumentFactory.getToken(),
                aws,
                cb: function (err) {
                    err.should.equal('err');
                    done();
                },
            });
        });

        it('does not ensure group and stream are present if nextToken for group/stream', function (done) {
            lib._nextToken = {'group:stream': 'test123'};
            lib.getToken({
                ...ArgumentFactory.getToken(),
                aws,
                cb: function () {
                    lib.ensureGroupPresent.notCalled.should.equal(true);
                    lib.getStream.notCalled.should.equal(true);
                    done();
                },
            });
        });
    });

    describe('ensureGroupPresent', function () {
        var aws;

        beforeEach(function () {
            aws = {
                describeLogStreams: function (params, cb) {
                    cb(null, {});
                },
            };
            lib.putRetentionPolicy = sinon.stub();
        });

        it('makes sure that a group is present', function (done) {
            lib.ensureGroupPresent({
                ...ArgumentFactory.ensureGroupPresent(),
                aws,
                cb: function (err, isPresent) {
                    should.not.exist(err);
                    isPresent.should.equal(true);
                    lib.putRetentionPolicy
                        .calledWith({...ArgumentFactory.ensureGroupPresent(), aws})
                        .should.equal(true);
                    done();
                },
            });
        });

        it('creates a group if it is not present', function (done) {
            var err = {name: 'ResourceNotFoundException'};
            aws.describeLogStreams = sinon.stub().yields(err);
            aws.createLogGroup = sinon.stub().yields(null);

            lib.ensureGroupPresent({
                ...ArgumentFactory.ensureGroupPresent(),
                aws,
                cb: function (err, isPresent) {
                    should.not.exist(err);
                    lib.putRetentionPolicy
                        .calledWith({logGroupName: 'group', retentionInDays: 0, aws})
                        .should.equal(true);
                    isPresent.should.equal(true);
                    done();
                },
            });
        });

        it('errors if looking for a group errors', function (done) {
            aws.describeLogStreams = sinon.stub().yields('err');

            lib.ensureGroupPresent({
                ...ArgumentFactory.ensureGroupPresent(),
                aws,
                cb: function (err) {
                    err.should.equal('err');
                    done();
                },
            });
        });

        it('errors if creating a group errors', function (done) {
            var err = {name: 'ResourceNotFoundException'};
            aws.describeLogStreams = sinon.stub().yields(err);
            aws.createLogGroup = sinon.stub().yields('err');

            lib.ensureGroupPresent({
                ...ArgumentFactory.ensureGroupPresent(),
                aws,
                cb: function (err) {
                    err.should.equal('err');
                    lib.putRetentionPolicy.calledOnce.should.equal(false);
                    done();
                },
            });
        });
    });

    describe('getStream', function () {
        var aws;

        beforeEach(function () {
            aws = {
                describeLogStreams: function (params, cb) {
                    cb(null, {
                        logStreams: [
                            {
                                logStreamName: 'stream',
                            },
                            {
                                logStreamName: 'another-stream',
                            },
                        ],
                    });
                },
            };
        });

        it('yields the stream we want', function (done) {
            lib.getStream({
                aws,
                ...ArgumentFactory.getStream(),
                cb: function (err, stream) {
                    stream.logStreamName.should.equal('stream');
                    done();
                },
            });
        });

        it('errors if getting streams errors', function (done) {
            aws.describeLogStreams = function (params, cb) {
                cb('err');
            };

            lib.getStream({
                aws,
                ...ArgumentFactory.getStream(),
                cb: function (err, stream) {
                    should.not.exist(stream);
                    err.should.equal('err');
                    done();
                },
            });
        });

        it('errors if creating stream errors', function (done) {
            aws.describeLogStreams = sinon.stub().yields(null, []);
            aws.createLogStream = function (params, cb) {
                cb('err');
            };

            lib.getStream({
                aws,
                ...ArgumentFactory.getStream(),
                cb: function (err, stream) {
                    should.not.exist(stream);
                    err.should.equal('err');
                    done();
                },
            });
        });

        it('ignores in progress error (aborted)', function (done) {
            aws.describeLogStreams = sinon.stub();
            aws.describeLogStreams
                .onCall(0)
                .yields(null, [])
                .onCall(1)
                .yields(null, {
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
            aws.createLogStream = sinon.stub().yields(err);

            lib.getStream({
                aws,
                ...ArgumentFactory.getStream(),
                cb: function (err, stream) {
                    should.exist({logStreamName: 'stream'});
                    should.not.exist(err);
                    done();
                },
            });
        });

        it('ignores in progress error (already exist)', function (done) {
            aws.describeLogStreams = sinon.stub();
            aws.describeLogStreams
                .onCall(0)
                .yields(null, [])
                .onCall(1)
                .yields(null, {
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
            aws.createLogStream = sinon.stub().yields(err);

            lib.getStream({
                aws,
                ...ArgumentFactory.getStream(),
                cb: function (err, stream) {
                    should.exist({logStreamName: 'stream'});
                    should.not.exist(err);
                    done();
                },
            });
        });
    });

    describe('ignoreInProgress', function () {
        it('can be used to filter callback errors', function (done) {
            function typicalCallback(err, result) {
                err.should.equal('err');
                result.should.equal('result');
                done();
            }

            var filter = lib.ignoreInProgress(typicalCallback);
            filter.should.be.an.instanceOf(Function);
            filter('err', 'result');
        });

        it('ignores a OperationAbortedException', function (done) {
            function runner(cb) {
                var err = {name: 'OperationAbortedException'};
                cb(err);
            }

            runner(
                lib.ignoreInProgress(function (err) {
                    should.not.exist(err);
                    done();
                })
            );
        });

        it('ignores a ResourceAlreadyExistsException', function (done) {
            function runner(cb) {
                var err = {name: 'ResourceAlreadyExistsException'};
                cb(err);
            }

            runner(
                lib.ignoreInProgress(function (err) {
                    should.not.exist(err);
                    done();
                })
            );
        });

        it('does not ignore any other error', function (done) {
            function runner(cb) {
                var err = {name: 'BoatTooLittleException'};
                cb(err);
            }

            runner(
                lib.ignoreInProgress(function (err) {
                    should.exist(err);
                    err.name.should.equal('BoatTooLittleException');
                    done();
                })
            );
        });
    });

    describe('submitWithAnotherToken', function () {
        var aws = {};

        beforeEach(function () {
            aws.putLogEvents = sinon.stub().yields();
            sinon.stub(lib, 'getToken').yieldsTo('cb', null, 'new-token');
            sinon.stub(console, 'error');
        });

        afterEach(function () {
            lib.getToken.restore();
            console.error.restore();
        });

        it('gets a token then resubmits', function (done) {
            lib.submitWithAnotherToken({
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
