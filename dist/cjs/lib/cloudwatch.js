"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const LIMITS = {
    MAX_EVENT_MSG_SIZE_BYTES: 256000,
    MAX_BATCH_SIZE_BYTES: 1000000, // We leave some fudge factor here too.
};
// CloudWatch adds 26 bytes per log event based on their documentation:
// https://docs.aws.amazon.com/AmazonCloudWatchLogs/latest/APIReference/API_PutLogEvents.html
const BASE_EVENT_SIZE_BYTES = 26;
const utils_js_1 = require("./utils.js");
const index_js_1 = require("./errors/index.js");
const CloudWatch = {
    _postingEvents: {},
    _nextToken: {},
    upload: ({ aws, logGroupName, logStreamName, logEvents, retentionInDays, options, cb }) => {
        (0, utils_js_1.debug)('upload', logEvents);
        // trying to send a batch before the last completed
        // would cause InvalidSequenceTokenException.
        if (CloudWatch._postingEvents[logStreamName] || logEvents.length <= 0) {
            (0, utils_js_1.debug)('nothing to do or already doing something');
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
        (0, utils_js_1.debug)('safeupload', logEvents);
        CloudWatch.getToken({
            aws,
            logGroupName,
            logStreamName,
            retentionInDays,
            options,
            cb: function (err, token) {
                if (err) {
                    (0, utils_js_1.debug)('error getting token', err, true);
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
                        const msgTooBigErr = new index_js_1.MessageTooBigError('Message Truncated because it exceeds the CloudWatch size limit');
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
                    (0, utils_js_1.debug)('sent to aws, err: ', err, ' data: ', data);
                    if (err) {
                        // InvalidSequenceToken means we need to do a describe to get another token
                        // also do the same if ResourceNotFound as that will result in the last token
                        // for the group being set to null
                        if (err.name === 'InvalidSequenceTokenException' || err.name === 'ResourceNotFoundException') {
                            (0, utils_js_1.debug)(err.name + ', retrying', true);
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
                            (0, utils_js_1.debug)('error during putLogEvents', err, true);
                            CloudWatch.retrySubmit({ aws, payload, times: 3, cb });
                        }
                    }
                    else {
                        (0, utils_js_1.debug)('data', data);
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
        (0, utils_js_1.debug)('retrying to upload', times, 'more times');
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
            (0, utils_js_1.debug)('using existing next token and assuming exists', existingNextToken);
            cb(null, existingNextToken);
            return;
        }
        const calls = options.ensureLogGroup !== false
            ? [
                CloudWatch.ensureGroupPresent({ aws, logGroupName, retentionInDays }),
                CloudWatch.getStream({ aws, logGroupName, logStreamName }),
            ]
            : [CloudWatch.getStream({ aws, logGroupName, logStreamName })];
        Promise.all(calls)
            .then((values) => {
            const stream = (calls.length === 1 ? values[0] : values[1]);
            (0, utils_js_1.debug)('token found', stream.uploadSequenceToken);
            cb(null, stream.uploadSequenceToken);
        })
            .catch((e) => {
            (0, utils_js_1.debug)('token not found', e);
            cb(e);
        });
    },
    previousKeyMapKey: (group, stream) => {
        return group + ':' + stream;
    },
    ensureGroupPresent: ({ aws, logGroupName, retentionInDays }) => __awaiter(void 0, void 0, void 0, function* () {
        return new Promise((resolve, reject) => __awaiter(void 0, void 0, void 0, function* () {
            yield aws.describeLogStreams({ logGroupName }).catch((e) => __awaiter(void 0, void 0, void 0, function* () {
                if (e.name === 'ResourceNotFoundException') {
                    aws.createLogGroup({ logGroupName })
                        .then(() => {
                        CloudWatch.putRetentionPolicy({ aws, logGroupName, retentionInDays })
                            .then(() => resolve(true))
                            .catch(reject);
                    })
                        .catch(reject);
                }
                else {
                    reject(e);
                }
            }));
            CloudWatch.putRetentionPolicy({ aws, logGroupName, retentionInDays })
                .then(() => resolve(true))
                .catch(reject);
        }));
    }),
    putRetentionPolicy: ({ aws, logGroupName, retentionInDays }) => __awaiter(void 0, void 0, void 0, function* () {
        if (retentionInDays > 0) {
            yield aws
                .putRetentionPolicy({ logGroupName, retentionInDays })
                .catch((err) => console.error('failed to set retention policy for ' +
                logGroupName +
                ' to ' +
                retentionInDays +
                ' days due to ' +
                err.stack));
        }
    }),
    getStream: ({ aws, logGroupName, logStreamName }) => {
        return new Promise((resolve, reject) => __awaiter(void 0, void 0, void 0, function* () {
            const params = {
                logGroupName,
                logStreamNamePrefix: logStreamName,
            };
            aws.describeLogStreams(params)
                .then((response) => __awaiter(void 0, void 0, void 0, function* () {
                var _a;
                let stream = (_a = response.logStreams) === null || _a === void 0 ? void 0 : _a.find((stream) => stream.logStreamName === logStreamName);
                if (!stream) {
                    (0, utils_js_1.debug)('creating stream');
                    let shouldResolve = true;
                    yield aws.createLogStream({ logGroupName, logStreamName }).catch((e) => {
                        if (!CloudWatch.ignoreInProgress(e)) {
                            shouldResolve = false;
                            reject(e);
                        }
                    });
                    if (shouldResolve) {
                        CloudWatch.getStream({ aws, logGroupName, logStreamName })
                            .then((response) => {
                            resolve(response);
                        })
                            .catch((e) => reject(e));
                    }
                }
                else {
                    resolve(stream);
                }
            }))
                .catch(reject);
        }));
    },
    ignoreInProgress: (err) => {
        if (err.name == 'OperationAbortedException' || err.name == 'ResourceAlreadyExistsException') {
            (0, utils_js_1.debug)('ignore operation in progress', err.message);
            return true;
        }
        return false;
    },
};
exports.default = CloudWatch;
