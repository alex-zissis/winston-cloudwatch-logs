import { CloudWatchLogs, LogStream } from '@aws-sdk/client-cloudwatch-logs';
import { LogEntry } from 'winston';
import { WinstonCloudWatchOptions } from '../WinstonCloudWatch.js';
export declare type MessageFormatFunc = (log: LogEntry) => string;
export declare type LogEvent = {
    message: string;
    timestamp: number;
};
interface CloudWatchArgumentsBase<T = undefined> {
    logGroupName: string;
    logStreamName: string;
    retentionInDays: number;
    options: WinstonCloudWatchOptions;
    cb: (err?: Error, data?: T) => void;
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
interface CloudWatchSubmissionArgs extends Pick<CloudWatchArgumentsWithPayload, 'cb' | 'payload'> {
    times: number;
}
interface ICloudWatch {
    aws: CloudWatchLogs;
    upload: (args: CloudWatchUploadArgs) => void;
    init: (aws: CloudWatchLogs) => void;
    _safeUpload: (args: CloudWatchUploadArgs) => void;
    _getToken: (args: CloudWatchArgumentsBase<string>) => void;
    _submitWithAnotherToken: (args: CloudWatchArgumentsWithPayload) => void;
    _retrySubmit: (args: CloudWatchSubmissionArgs) => void;
    _previousKeyMapKey: (logGroupName: string, logStreamName: string) => string;
    _postingEvents: object;
    _nextToken: object;
    _ensureGroupPresent: (args: Pick<CloudWatchArgumentsBase<boolean>, 'logGroupName' | 'retentionInDays'>) => Promise<boolean>;
    _putRetentionPolicy: (args: Pick<CloudWatchArgumentsBase<boolean>, 'logGroupName' | 'retentionInDays'>) => Promise<void>;
    _getStream: (args: Pick<CloudWatchArgumentsBase<LogStream>, 'logGroupName' | 'logStreamName'>) => Promise<LogStream>;
    _ignoreInProgress: (err: Error) => boolean;
}
declare const CloudWatch: ICloudWatch;
export default CloudWatch;
