/// <reference types="node" />
import winston, { LogEntry } from 'winston';
import TransportStream from 'winston-transport';
import { CloudWatchLogs, CloudWatchLogsClientConfig } from '@aws-sdk/client-cloudwatch-logs';
import { LogEvent, MessageFormatFunc } from './lib/cloudwatch.js';
export interface WinstonCloudWatchOptions extends winston.transport.TransportStreamOptions {
    name?: string;
    logGroupName: string | (() => string);
    logStreamName: string | (() => string);
    retentionInDays?: number;
    awsAccessKeyId?: string;
    awsSecretKey?: string;
    awsRegion?: string;
    awsOptions?: CloudWatchLogsClientConfig;
    cloudWatchLogs?: CloudWatchLogs;
    proxyServer?: string;
    messageFormatter?: MessageFormatFunc;
    jsonMessage?: boolean;
    uploadRate?: number;
    errorHandler?: (err: Error) => void;
    ensureLogGroup?: boolean;
}
declare class WinstonCloudWatch extends TransportStream {
    #private;
    name: string;
    flushTimeout?: number;
    get logGroupName(): string;
    get logStreamName(): string;
    retentionInDays: number;
    options: WinstonCloudWatchOptions;
    cloudwatchlogs: CloudWatchLogs;
    intervalId?: NodeJS.Timer;
    formatMessage: MessageFormatFunc;
    uploadRate: number;
    logEvents: LogEvent[];
    errorHandler?: (err: Error) => void;
    proxyServer?: string;
    constructor(options: WinstonCloudWatchOptions);
    add(log: LogEntry): void;
    log(info: LogEntry, callback: (err?: Error, data?: boolean) => void): void;
    submit(cb: (err?: Error) => void): void;
    kthxbye(cb: (err?: Error) => void): void;
}
export default WinstonCloudWatch;
