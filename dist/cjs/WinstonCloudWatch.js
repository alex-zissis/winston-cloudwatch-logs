"use strict";
var __classPrivateFieldSet = (this && this.__classPrivateFieldSet) || function (receiver, state, value, kind, f) {
    if (kind === "m") throw new TypeError("Private method is not writable");
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return (kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value)), value;
};
var __classPrivateFieldGet = (this && this.__classPrivateFieldGet) || function (receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _WinstonCloudWatch_instances, _WinstonCloudWatch_logGroupName, _WinstonCloudWatch_logStreamName, _WinstonCloudWatch_createCloudwatchLogsInstance;
Object.defineProperty(exports, "__esModule", { value: true });
const winston_1 = __importDefault(require("winston"));
const winston_transport_1 = __importDefault(require("winston-transport"));
const client_cloudwatch_logs_1 = require("@aws-sdk/client-cloudwatch-logs");
const node_http_handler_1 = require("@aws-sdk/node-http-handler");
const proxy_agent_1 = __importDefault(require("proxy-agent"));
const index_js_1 = require("./lib/nodash/index.js");
const utils_js_1 = require("./lib/utils.js");
const cloudwatch_js_1 = __importDefault(require("./lib/cloudwatch.js"));
const DefaultFlushTimeoutMs = 10000;
class WinstonCloudWatch extends winston_transport_1.default {
    constructor(options) {
        var _a;
        super(options);
        _WinstonCloudWatch_instances.add(this);
        _WinstonCloudWatch_logGroupName.set(this, void 0);
        _WinstonCloudWatch_logStreamName.set(this, void 0);
        const { level, name, cloudWatchLogs, logGroupName, logStreamName, messageFormatter, jsonMessage, uploadRate, errorHandler, proxyServer, } = options;
        this.level = level !== null && level !== void 0 ? level : 'info';
        this.name = name !== null && name !== void 0 ? name : 'Cloudwatch';
        __classPrivateFieldSet(this, _WinstonCloudWatch_logGroupName, logGroupName, "f");
        __classPrivateFieldSet(this, _WinstonCloudWatch_logStreamName, logStreamName, "f");
        this.retentionInDays = (_a = this.retentionInDays) !== null && _a !== void 0 ? _a : 0;
        this.options = options;
        const fmt = messageFormatter !== null && messageFormatter !== void 0 ? messageFormatter : (({ level, message }) => [level, message].join(' - '));
        this.formatMessage = jsonMessage ? utils_js_1.stringify : fmt;
        this.proxyServer = proxyServer;
        this.uploadRate = uploadRate !== null && uploadRate !== void 0 ? uploadRate : 2000;
        this.logEvents = [];
        this.errorHandler = errorHandler;
        this.cloudwatchlogs = cloudWatchLogs !== null && cloudWatchLogs !== void 0 ? cloudWatchLogs : __classPrivateFieldGet(this, _WinstonCloudWatch_instances, "m", _WinstonCloudWatch_createCloudwatchLogsInstance).call(this);
    }
    get logGroupName() {
        return typeof __classPrivateFieldGet(this, _WinstonCloudWatch_logGroupName, "f") === 'function' ? __classPrivateFieldGet(this, _WinstonCloudWatch_logGroupName, "f").call(this) : __classPrivateFieldGet(this, _WinstonCloudWatch_logGroupName, "f");
    }
    get logStreamName() {
        return typeof __classPrivateFieldGet(this, _WinstonCloudWatch_logStreamName, "f") === 'function' ? __classPrivateFieldGet(this, _WinstonCloudWatch_logStreamName, "f").call(this) : __classPrivateFieldGet(this, _WinstonCloudWatch_logStreamName, "f");
    }
    add(log) {
        (0, utils_js_1.debug)('add log to queue', log);
        if (!(0, index_js_1.isEmpty)(log.message) || (0, index_js_1.isError)(log.message)) {
            this.logEvents.push({
                message: this.formatMessage(log),
                timestamp: new Date().getTime(),
            });
        }
        if (!this.intervalId) {
            (0, utils_js_1.debug)('creating interval');
            this.intervalId = setInterval(() => {
                this.submit((err) => {
                    if (err) {
                        (0, utils_js_1.debug)('error during submit', err, true);
                        this.errorHandler ? this.errorHandler(err) : console.error(err);
                    }
                });
            }, this.uploadRate);
        }
    }
    log(info, callback) {
        (0, utils_js_1.debug)('log (called by winston)', info);
        if (!(0, index_js_1.isEmpty)(info.message) || (0, index_js_1.isError)(info.message)) {
            this.add(info);
        }
        if (!/^uncaughtException: /.test(info.message)) {
            // do not wait, just return right away
            return callback(null, true);
        }
        (0, utils_js_1.debug)('message not empty, proceeding');
        // clear interval and send logs immediately
        // as Winston is about to end the process
        clearInterval(this.intervalId);
        this.intervalId = null;
        this.submit(callback);
    }
    submit(cb) {
        if ((0, index_js_1.isEmpty)(this.logEvents)) {
            return cb();
        }
        cloudwatch_js_1.default.upload({
            aws: this.cloudwatchlogs,
            logGroupName: this.logGroupName,
            logStreamName: this.logStreamName,
            logEvents: this.logEvents,
            retentionInDays: this.retentionInDays,
            options: this.options,
            cb,
        });
    }
    kthxbye(cb) {
        (0, utils_js_1.debug)('clearing interval');
        clearInterval(this.intervalId);
        this.intervalId = null;
        (0, utils_js_1.debug)('interval cleared');
        this.flushTimeout = this.flushTimeout || Date.now() + DefaultFlushTimeoutMs;
        (0, utils_js_1.debug)('flush timeout set to', this.flushTimeout);
        this.submit(function (error) {
            (0, utils_js_1.debug)('submit done', error);
            if (error)
                return cb(error);
            if ((0, index_js_1.isEmpty)(this.logEvents))
                return cb();
            if (Date.now() > this.flushTimeout)
                return cb(new Error('Timeout reached while waiting for logs to submit'));
            else
                setTimeout(this.kthxbye.bind(this, cb), 0);
        }.bind(this));
    }
}
_WinstonCloudWatch_logGroupName = new WeakMap(), _WinstonCloudWatch_logStreamName = new WeakMap(), _WinstonCloudWatch_instances = new WeakSet(), _WinstonCloudWatch_createCloudwatchLogsInstance = function _WinstonCloudWatch_createCloudwatchLogsInstance() {
    let config = {};
    const { awsAccessKeyId, awsRegion, awsSecretKey, awsOptions } = this.options;
    if (awsAccessKeyId && awsSecretKey && awsRegion) {
        config = { credentials: { accessKeyId: awsAccessKeyId, secretAccessKey: awsAccessKeyId }, region: awsRegion };
    }
    else if (awsRegion && !awsAccessKeyId && !awsSecretKey) {
        // Amazon SDK will automatically pull access credentials
        // from IAM Role when running on EC2 but region still
        // needs to be configured
        config = { region: awsRegion };
    }
    if (this.proxyServer) {
        const proxyAgent = new proxy_agent_1.default(this.proxyServer);
        config.requestHandler = new node_http_handler_1.NodeHttpHandler({ httpAgent: proxyAgent, httpsAgent: proxyAgent });
    }
    return new client_cloudwatch_logs_1.CloudWatchLogs(Object.assign(Object.assign({}, awsOptions), config));
};
winston_1.default.transports.CloudWatch = WinstonCloudWatch;
exports.default = WinstonCloudWatch;
