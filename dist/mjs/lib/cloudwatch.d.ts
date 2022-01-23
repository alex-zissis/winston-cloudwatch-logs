import { CloudWatchLogs, LogStream } from '@aws-sdk/client-cloudwatch-logs';
import { LogEntry } from 'winston';
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
    getToken: (args: CloudWatchArgumentsBase<string>) => void;
    submitWithAnotherToken: (args: CloudWatchArgumentsWithPayload) => void;
    retrySubmit: (args: CloudWatchSubmissionArgs) => void;
    previousKeyMapKey: (logGroupName: string, logStreamName: string) => string;
    _postingEvents: object;
    _nextToken: object;
    ensureGroupPresent: (args: Pick<CloudWatchArgumentsBase<boolean>, 'aws' | 'logGroupName' | 'retentionInDays'>) => Promise<boolean>;
    putRetentionPolicy: (args: Pick<CloudWatchArgumentsBase<boolean>, 'aws' | 'logGroupName' | 'retentionInDays'>) => Promise<void>;
    getStream: (args: Pick<CloudWatchArgumentsBase<LogStream>, 'aws' | 'logGroupName' | 'logStreamName'>) => Promise<LogStream>;
    ignoreInProgress: (err: Error) => boolean;
}
declare const CloudWatch: ICloudWatch;
export default CloudWatch;
