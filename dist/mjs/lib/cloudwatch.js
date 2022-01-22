const LIMITS = {
    MAX_EVENT_MSG_SIZE_BYTES: 256000,
    MAX_BATCH_SIZE_BYTES: 1000000, // We leave some fudge factor here too.
};
// CloudWatch adds 26 bytes per log event based on their documentation:
// https://docs.aws.amazon.com/AmazonCloudWatchLogs/latest/APIReference/API_PutLogEvents.html
const BASE_EVENT_SIZE_BYTES = 26;
import async from 'async';
import { debug } from './utils.js';
import { MessageTooBigError } from './errors/index.js';
const CloudWatch = {
    _postingEvents: {},
    _nextToken: {},
    upload: ({ aws, logGroupName, logStreamName, logEvents, retentionInDays, options, cb }) => {
        debug('upload', logEvents);
        // trying to send a batch before the last completed
        // would cause InvalidSequenceTokenException.
        if (CloudWatch._postingEvents[logStreamName] || logEvents.length <= 0) {
            debug('nothing to do or already doing something');
            return cb();
        }
        CloudWatch._postingEvents[logStreamName] = true;
        CloudWatch.safeUpload({
            aws,
            logGroupName,
            logStreamName,
            logEvents,
            retentionInDays,
            options,
            cb: function (err) {
                CloudWatch._postingEvents[logStreamName] = false;
                return cb(err);
            },
        });
    },
    // safeUpload introduced after https://github.com/lazywithclass/winston-cloudwatch/issues/55
    // Note that calls to upload() can occur at a greater frequency
    // than getToken() responses are processed. By way of example, consider if add() is
    // called at 0s and 1.1s, each time with a single event, and upload() is called
    // at 1.0s and 2.0s, with the same logEvents array, but calls to getToken()
    // take 1.5s to return. When the first call to getToken() DOES return,
    // it will send both events and empty the array. Then, when the second call
    // go getToken() returns, without this check also here, it would attempt to send
    // an empty array, resulting in the InvalidParameterException.
    safeUpload: ({ aws, logGroupName, logStreamName, logEvents, retentionInDays, options, cb }) => {
        debug('safeupload', logEvents);
        CloudWatch.getToken({
            aws,
            logGroupName,
            logStreamName,
            retentionInDays,
            options,
            cb: function (err, token) {
                if (err) {
                    debug('error getting token', err, true);
                    return cb(err);
                }
                var entryIndex = 0;
                var bytes = 0;
                while (entryIndex < logEvents.length) {
                    var ev = logEvents[entryIndex];
                    // unit tests pass null elements
                    var evSize = ev ? Buffer.byteLength(ev.message, 'utf8') + BASE_EVENT_SIZE_BYTES : 0;
                    if (evSize > LIMITS.MAX_EVENT_MSG_SIZE_BYTES) {
                        evSize = LIMITS.MAX_EVENT_MSG_SIZE_BYTES;
                        ev.message = ev.message.substring(0, evSize);
                        const msgTooBigErr = new MessageTooBigError('Message Truncated because it exceeds the CloudWatch size limit');
                        msgTooBigErr.logEvent = ev;
                        cb(msgTooBigErr);
                    }
                    if (bytes + evSize > LIMITS.MAX_BATCH_SIZE_BYTES)
                        break;
                    bytes += evSize;
                    entryIndex++;
                }
                const payload = {
                    logGroupName,
                    logStreamName,
                    logEvents: logEvents.splice(0, entryIndex),
                };
                // @ts-ignore
                if (token)
                    payload.sequenceToken = token;
                CloudWatch._postingEvents[logStreamName] = true;
                aws.putLogEvents(payload, function (err, data) {
                    debug('sent to aws, err: ', err, ' data: ', data);
                    if (err) {
                        // InvalidSequenceToken means we need to do a describe to get another token
                        // also do the same if ResourceNotFound as that will result in the last token
                        // for the group being set to null
                        if (err.name === 'InvalidSequenceTokenException' || err.name === 'ResourceNotFoundException') {
                            debug(err.name + ', retrying', true);
                            CloudWatch.submitWithAnotherToken({
                                aws,
                                logGroupName,
                                logStreamName,
                                payload,
                                retentionInDays,
                                options,
                                cb,
                            });
                        }
                        else {
                            debug('error during putLogEvents', err, true);
                            CloudWatch.retrySubmit({ aws, payload, times: 3, cb });
                        }
                    }
                    else {
                        debug('data', data);
                        if (data && data.nextSequenceToken) {
                            CloudWatch._nextToken[CloudWatch.previousKeyMapKey(logGroupName, logStreamName)] =
                                data.nextSequenceToken;
                        }
                        CloudWatch._postingEvents[logStreamName] = false;
                        cb();
                    }
                });
            },
        });
    },
    submitWithAnotherToken: ({ aws, logGroupName, logStreamName, payload, retentionInDays, options, cb }) => {
        CloudWatch._nextToken[CloudWatch.previousKeyMapKey(logGroupName, logStreamName)] = null;
        CloudWatch.getToken({
            aws,
            logGroupName,
            logStreamName,
            retentionInDays,
            options,
            cb: function (err, token) {
                payload.sequenceToken = token;
                aws.putLogEvents(payload, function (err) {
                    CloudWatch._postingEvents[logStreamName] = false;
                    cb(err);
                });
            },
        });
    },
    retrySubmit: ({ aws, payload, times, cb }) => {
        debug('retrying to upload', times, 'more times');
        aws.putLogEvents(payload, function (err) {
            if (err && times > 0) {
                CloudWatch.retrySubmit({ aws, payload, times: times - 1, cb });
            }
            else {
                CloudWatch._postingEvents[payload.logStreamName] = false;
                cb(err);
            }
        });
    },
    getToken: ({ aws, logGroupName, logStreamName, retentionInDays, options, cb }) => {
        var existingNextToken = CloudWatch._nextToken[CloudWatch.previousKeyMapKey(logGroupName, logStreamName)];
        if (existingNextToken != null) {
            debug('using existing next token and assuming exists', existingNextToken);
            cb(null, existingNextToken);
            return;
        }
        const calls = options.ensureLogGroup !== false
            ? [
                CloudWatch.ensureGroupPresent.bind(null, { aws, logGroupName, retentionInDays, cb }),
                CloudWatch.getStream.bind(null, { aws, logGroupName, logStreamName, cb }),
            ]
            : [CloudWatch.getStream.bind(null, { aws, logGroupName, logStreamName, cb })];
        async.series(calls, function (err, resources) {
            const groupPresent = calls.length > 1 ? resources[0] : true;
            const stream = calls.length === 1 ? resources[0] : resources[1];
            if (groupPresent && stream) {
                debug('token found', stream.uploadSequenceToken);
                cb(err, stream.uploadSequenceToken);
            }
            else {
                debug('token not found', err);
                cb(err);
            }
        });
    },
    previousKeyMapKey: (group, stream) => {
        return group + ':' + stream;
    },
    ensureGroupPresent: ({ aws, logGroupName, retentionInDays, cb }) => {
        debug('ensure group present');
        const params = { logGroupName };
        aws.describeLogStreams(params, (err, data) => {
            // TODO we should cb(err, false) if there's an error?
            if (err && err.name == 'ResourceNotFoundException') {
                debug('create group');
                return aws.createLogGroup(params, CloudWatch.ignoreInProgress(function (err) {
                    if (!err)
                        CloudWatch.putRetentionPolicy({ aws, logGroupName, retentionInDays });
                    cb(err, err ? false : true);
                }));
            }
            else {
                debug('group found');
                CloudWatch.putRetentionPolicy({ aws, logGroupName, retentionInDays });
                cb(err, true);
            }
        });
    },
    putRetentionPolicy: ({ aws, logGroupName, retentionInDays }) => {
        const params = {
            logGroupName,
            retentionInDays,
        };
        if (retentionInDays > 0) {
            debug('setting retention policy for "' + logGroupName + '" to ' + retentionInDays + ' days');
            aws.putRetentionPolicy(params, function (err, data) {
                if (err)
                    console.error('failed to set retention policy for ' +
                        logGroupName +
                        ' to ' +
                        retentionInDays +
                        ' days due to ' +
                        err.stack);
            });
        }
    },
    getStream: ({ aws, logGroupName, logStreamName, cb }) => {
        const params = {
            logGroupName,
            logStreamNamePrefix: logStreamName,
        };
        aws.describeLogStreams(params, function (err, data) {
            debug('ensure stream present', err, data);
            if (err)
                return cb(err);
            var stream = data.logStreams?.find(function (stream) {
                return stream.logStreamName === logStreamName;
            });
            if (!stream) {
                debug('create stream');
                aws.createLogStream({
                    logGroupName,
                    logStreamName,
                }, CloudWatch.ignoreInProgress(function (err) {
                    if (err)
                        return cb(err);
                    CloudWatch.getStream({ aws, logGroupName, logStreamName, cb });
                }));
            }
            else {
                cb(null, stream);
            }
        });
    },
    ignoreInProgress: (cb) => {
        return function (err, data) {
            if (err && (err.name == 'OperationAbortedException' || err.name == 'ResourceAlreadyExistsException')) {
                debug('ignore operation in progress', err.message);
                cb(null, data);
            }
            else {
                cb(err, data);
            }
        };
    },
};
export default CloudWatch;
