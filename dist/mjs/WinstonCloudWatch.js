import winston from 'winston';
import TransportStream from 'winston-transport';
import { CloudWatchLogs } from '@aws-sdk/client-cloudwatch-logs';
import { NodeHttpHandler } from '@aws-sdk/node-http-handler';
import ProxyAgent from 'proxy-agent';
import { isEmpty, isError } from './lib/nodash/index.js';
import { debug, stringify } from './lib/utils.js';
import CloudWatch from './lib/cloudwatch.js';
const DefaultFlushTimeoutMs = 10000;
class WinstonCloudWatch extends TransportStream {
    name;
    #logGroupName;
    #logStreamName;
    flushTimeout;
    get logGroupName() {
        return typeof this.#logGroupName === 'function' ? this.#logGroupName() : this.#logGroupName;
    }
    get logStreamName() {
        return typeof this.#logStreamName === 'function' ? this.#logStreamName() : this.#logStreamName;
    }
    retentionInDays;
    options;
    cloudwatchlogs;
    intervalId;
    formatMessage;
    uploadRate;
    logEvents;
    errorHandler;
    proxyServer;
    constructor(options) {
        super(options);
        const { level, name, cloudWatchLogs, logGroupName, logStreamName, messageFormatter, jsonMessage, uploadRate, errorHandler, proxyServer, } = options;
        this.level = level ?? 'info';
        this.name = name ?? 'Cloudwatch';
        this.#logGroupName = logGroupName;
        this.#logStreamName = logStreamName;
        this.retentionInDays = this.retentionInDays ?? 0;
        this.options = options;
        const fmt = messageFormatter ?? (({ level, message }) => [level, message].join(' - '));
        this.formatMessage = jsonMessage ? stringify : fmt;
        this.proxyServer = proxyServer;
        this.uploadRate = uploadRate ?? 2000;
        this.logEvents = [];
        this.errorHandler = errorHandler;
        this.cloudwatchlogs = cloudWatchLogs ?? this.#createCloudwatchLogsInstance();
        CloudWatch.init(this.cloudwatchlogs);
    }
    #createCloudwatchLogsInstance() {
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
            const proxyAgent = new ProxyAgent(this.proxyServer);
            config.requestHandler = new NodeHttpHandler({ httpAgent: proxyAgent, httpsAgent: proxyAgent });
        }
        return new CloudWatchLogs({ ...awsOptions, ...config });
    }
    add(log) {
        debug('add log to queue', log);
        if (!isEmpty(log.message) || isError(log.message)) {
            this.logEvents.push({
                message: this.formatMessage(log),
                timestamp: new Date().getTime(),
            });
        }
        if (!this.intervalId) {
            debug('creating interval');
            this.intervalId = setInterval(() => {
                this.submit((err) => {
                    if (err) {
                        debug('error during submit', err, true);
                        this.errorHandler ? this.errorHandler(err) : console.error(err);
                    }
                });
            }, this.uploadRate);
        }
    }
    log(info, callback) {
        debug('log (called by winston)', info);
        if (!isEmpty(info.message) || isError(info.message)) {
            this.add(info);
        }
        if (!/^uncaughtException: /.test(info.message)) {
            // do not wait, just return right away
            return callback(null, true);
        }
        debug('message not empty, proceeding');
        // clear interval and send logs immediately
        // as Winston is about to end the process
        clearInterval(this.intervalId);
        this.intervalId = null;
        this.submit(callback);
    }
    submit(cb) {
        if (isEmpty(this.logEvents)) {
            return cb();
        }
        CloudWatch.upload({
            logGroupName: this.logGroupName,
            logStreamName: this.logStreamName,
            logEvents: this.logEvents,
            retentionInDays: this.retentionInDays,
            options: this.options,
        }, cb);
    }
    kthxbye(cb) {
        debug('clearing interval');
        clearInterval(this.intervalId);
        this.intervalId = null;
        debug('interval cleared');
        this.flushTimeout = this.flushTimeout || Date.now() + DefaultFlushTimeoutMs;
        debug('flush timeout set to', this.flushTimeout);
        this.submit(function (error) {
            debug('submit done', error);
            if (error)
                return cb(error);
            if (isEmpty(this.logEvents))
                return cb();
            if (Date.now() > this.flushTimeout)
                return cb(new Error('Timeout reached while waiting for logs to submit'));
            else
                setTimeout(this.kthxbye.bind(this, cb), 0);
        }.bind(this));
    }
}
winston.transports.CloudWatch = WinstonCloudWatch;
export default WinstonCloudWatch;
