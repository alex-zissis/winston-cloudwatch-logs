const LIMITS = {
    MAX_EVENT_MSG_SIZE_BYTES: 256000,
    MAX_BATCH_SIZE_BYTES: 1000000, // We leave some fudge factor here too.
};
// CloudWatch adds 26 bytes per log event based on their documentation:
// https://docs.aws.amazon.com/AmazonCloudWatchLogs/latest/APIReference/API_PutLogEvents.html
const BASE_EVENT_SIZE_BYTES = 26;
import { debug } from './utils.js';
import { MessageTooBigError } from './errors/index.js';
const CloudWatch = {
    _postingEvents: {},
    _nextToken: {},
    // lets KISS, and just ensure init has been run before we begin
    // @ts-expect-error
    aws: {},
    init: (aws) => {
        CloudWatch.aws = aws;
    },
    upload: ({ logGroupName, logStreamName, logEvents, retentionInDays, options, cb }) => {
        if (!CloudWatch.aws) {
            cb(new Error("CloudWatch logs client was not found. Have you run `CloudWatch.init(client)`?"));
        }
        debug('upload', logEvents);
        // trying to send a batch before the last completed
        // would cause InvalidSequenceTokenException.
        if (CloudWatch._postingEvents[logStreamName] || logEvents.length <= 0) {
            debug('nothing to do or already doing something');
            return cb();
        }
        CloudWatch._postingEvents[logStreamName] = true;
        CloudWatch._safeUpload({
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
    _safeUpload: ({ logGroupName, logStreamName, logEvents, retentionInDays, options, cb }) => {
        debug('safeupload', logEvents);
        CloudWatch._getToken({
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
                CloudWatch.aws.putLogEvents(payload, function (err, data) {
                    debug('sent to CloudWatch.aws, err: ', err, ' data: ', data);
                    if (err) {
                        // InvalidSequenceToken means we need to do a describe to get another token
                        // also do the same if ResourceNotFound as that will result in the last token
                        // for the group being set to null
                        if (err.name === 'InvalidSequenceTokenException' || err.name === 'ResourceNotFoundException') {
                            debug(err.name + ', retrying', true);
                            CloudWatch._submitWithAnotherToken({
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
                            CloudWatch._retrySubmit({ payload, times: 3, cb });
                        }
                    }
                    else {
                        debug('data', data);
                        if (data && data.nextSequenceToken) {
                            CloudWatch._nextToken[CloudWatch._previousKeyMapKey(logGroupName, logStreamName)] =
                                data.nextSequenceToken;
                        }
                        CloudWatch._postingEvents[logStreamName] = false;
                        cb();
                    }
                });
            },
        });
    },
    _submitWithAnotherToken: ({ logGroupName, logStreamName, payload, retentionInDays, options, cb }) => {
        CloudWatch._nextToken[CloudWatch._previousKeyMapKey(logGroupName, logStreamName)] = null;
        CloudWatch._getToken({
            logGroupName,
            logStreamName,
            retentionInDays,
            options,
            cb: function (err, token) {
                payload.sequenceToken = token;
                CloudWatch.aws.putLogEvents(payload, function (err) {
                    CloudWatch._postingEvents[logStreamName] = false;
                    cb(err);
                });
            },
        });
    },
    _retrySubmit: ({ payload, times, cb }) => {
        debug('retrying to upload', times, 'more times');
        CloudWatch.aws.putLogEvents(payload, function (err) {
            if (err && times > 0) {
                CloudWatch._retrySubmit({ payload, times: times - 1, cb });
            }
            else {
                CloudWatch._postingEvents[payload.logStreamName] = false;
                cb(err);
            }
        });
    },
    _getToken: ({ logGroupName, logStreamName, retentionInDays, options, cb }) => {
        var existingNextToken = CloudWatch._nextToken[CloudWatch._previousKeyMapKey(logGroupName, logStreamName)];
        if (existingNextToken != null) {
            debug('using existing next token and assuming exists', existingNextToken);
            cb(null, existingNextToken);
            return;
        }
        const calls = options.ensureLogGroup !== false
            ? [
                CloudWatch._ensureGroupPresent({ logGroupName, retentionInDays }),
                CloudWatch._getStream({ logGroupName, logStreamName }),
            ]
            : [CloudWatch._getStream({ logGroupName, logStreamName })];
        Promise.all(calls)
            .then((values) => {
            const stream = (calls.length === 1 ? values[0] : values[1]);
            debug('token found', stream.uploadSequenceToken);
            cb(null, stream.uploadSequenceToken);
        })
            .catch((e) => {
            debug('token not found', e);
            cb(e);
        });
    },
    _previousKeyMapKey: (group, stream) => {
        return group + ':' + stream;
    },
    _ensureGroupPresent: async ({ logGroupName, retentionInDays }) => {
        return new Promise(async (resolve, reject) => {
            await CloudWatch.aws.describeLogStreams({ logGroupName }).catch(async (e) => {
                if (e.name === 'ResourceNotFoundException') {
                    CloudWatch.aws.createLogGroup({ logGroupName })
                        .then(() => {
                        CloudWatch._putRetentionPolicy({ logGroupName, retentionInDays })
                            .then(() => resolve(true))
                            .catch(reject);
                    })
                        .catch(reject);
                }
                else {
                    reject(e);
                }
            });
            CloudWatch._putRetentionPolicy({ logGroupName, retentionInDays })
                .then(() => resolve(true))
                .catch(reject);
        });
    },
    _putRetentionPolicy: async ({ logGroupName, retentionInDays }) => {
        if (retentionInDays > 0) {
            await CloudWatch.aws
                .putRetentionPolicy({ logGroupName, retentionInDays })
                .catch((err) => console.error('failed to set retention policy for ' +
                logGroupName +
                ' to ' +
                retentionInDays +
                ' days due to ' +
                err.stack));
        }
    },
    _getStream: ({ logGroupName, logStreamName }) => {
        return new Promise(async (resolve, reject) => {
            const params = {
                logGroupName,
                logStreamNamePrefix: logStreamName,
            };
            CloudWatch.aws.describeLogStreams(params)
                .then(async (response) => {
                let stream = response.logStreams?.find((stream) => stream.logStreamName === logStreamName);
                if (!stream) {
                    debug('creating stream');
                    let shouldResolve = true;
                    await CloudWatch.aws.createLogStream({ logGroupName, logStreamName }).catch((e) => {
                        if (!CloudWatch._ignoreInProgress(e)) {
                            shouldResolve = false;
                            reject(e);
                        }
                    });
                    if (shouldResolve) {
                        CloudWatch._getStream({ logGroupName, logStreamName })
                            .then((response) => {
                            resolve(response);
                        })
                            .catch((e) => reject(e));
                    }
                }
                else {
                    resolve(stream);
                }
            })
                .catch(reject);
        });
    },
    _ignoreInProgress: (err) => {
        if (err.name == 'OperationAbortedException' || err.name == 'ResourceAlreadyExistsException') {
            debug('ignore operation in progress', err.message);
            return true;
        }
        return false;
    },
};
export default CloudWatch;
