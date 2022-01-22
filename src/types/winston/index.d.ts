import {transports} from 'winston';
import WinstonCloudWatch, {WinstonCloudWatchOptions} from '../../WinstonCloudWatch';

declare module 'winston/lib/winston/transports' {
    export interface Transports {
        CloudWatch: typeof WinstonCloudWatch;
        CloudWatchTransportOptions: WinstonCloudWatchOptions;
    }
}
