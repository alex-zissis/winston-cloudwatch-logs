import { CloudWatchLogs, LogStream } from '@aws-sdk/client-cloudwatch-logs';
import { LogEntry } from 'winston';
import { WinstonCloudWatchOptions } from '../WinstonCloudWatch.js';
export declare type MessageFormatFunc = (log: LogEntry) => string;
export declare type LogEvent = {
    message: string;
    timestamp: number;
};
interface CloudWatchArgumentsBase {
    logGroupName: string;
    logStreamName: string;
    retentionInDays: number;
    options: WinstonCloudWatchOptions;
}
interface CloudWatchUploadArgs extends CloudWatchArgumentsBase {
    logEvents: LogEvent[];
}
interface CloudWatchPayload {
    logGroupName: string;
    logStreamName: string;
    logEvents: LogEvent[];
    sequenceToken?: string;
}
interface CloudWatchArgumentsWithPayload extends CloudWatchArgumentsBase {
    payload: CloudWatchPayload;
}
interface CloudWatchSubmissionArgs extends Pick<CloudWatchArgumentsWithPayload, 'payload'> {
    times: number;
}
interface ICloudWatch {
    aws: CloudWatchLogs;
    upload: (args: CloudWatchUploadArgs, cb: (err?: Error) => void) => void;
    init: (aws: CloudWatchLogs) => void;
    _safeUpload: (args: CloudWatchUploadArgs, cb: (err?: Error) => void) => Promise<void>;
    _getToken: (args: CloudWatchArgumentsBase) => Promise<string>;
    _submitWithAnotherToken: (args: CloudWatchArgumentsWithPayload) => Promise<void>;
    _retrySubmit: (args: CloudWatchSubmissionArgs) => Promise<void>;
    _ensureGroupPresent: (args: Pick<CloudWatchArgumentsBase, 'logGroupName' | 'retentionInDays'>) => Promise<boolean>;
    _putRetentionPolicy: (args: Pick<CloudWatchArgumentsBase, 'logGroupName' | 'retentionInDays'>) => Promise<void>;
    _getStream: (args: Pick<CloudWatchArgumentsBase, 'logGroupName' | 'logStreamName'>) => Promise<LogStream>;
    _ignoreInProgress: (err: Error) => boolean;
    _previousKeyMapKey: (logGroupName: string, logStreamName: string) => string;
    _postingEvents: object;
    _nextToken: object;
}
declare const CloudWatch: ICloudWatch;
export default CloudWatch;
