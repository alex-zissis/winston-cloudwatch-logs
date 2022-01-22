import { CloudWatchLogs, LogStream } from '@aws-sdk/client-cloudwatch-logs';
import { LogCallback, LogEntry } from 'winston';
import { WinstonCloudWatchOptions } from '../WinstonCloudWatch.js';
export declare type MessageFormatFunc = (log: LogEntry) => string;
export declare type LogEvent = {
    message: string;
    timestamp: number;
};
interface CloudWatchArgumentsBase<T = undefined> {
    aws: CloudWatchLogs;
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
interface CloudWatchSubmissionArgs extends Pick<CloudWatchArgumentsWithPayload, 'cb' | 'aws' | 'payload'> {
    times: number;
}
interface ICloudWatch {
    upload: (args: CloudWatchUploadArgs) => void;
    safeUpload: (args: CloudWatchUploadArgs) => void;
    getToken: (args: CloudWatchArgumentsBase) => void;
    submitWithAnotherToken: (args: CloudWatchArgumentsWithPayload) => void;
    retrySubmit: (args: CloudWatchSubmissionArgs) => void;
    ensureGroupPresent: (args: Pick<CloudWatchArgumentsBase<boolean>, 'aws' | 'logGroupName' | 'retentionInDays' | 'cb'>) => void;
    putRetentionPolicy: (args: Pick<CloudWatchArgumentsBase, 'aws' | 'logGroupName' | 'retentionInDays'>) => void;
    getStream: (args: Pick<CloudWatchArgumentsBase<LogStream>, 'aws' | 'logGroupName' | 'logStreamName' | 'cb'>) => void;
    previousKeyMapKey: (logGroupName: string, logStreamName: string) => string;
    _postingEvents: object;
    _nextToken: object;
    ignoreInProgress: (cb: LogCallback) => (err: Error, data: any) => void;
}
declare const CloudWatch: ICloudWatch;
export default CloudWatch;
