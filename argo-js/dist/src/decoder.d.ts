import { ExecutionResult } from 'graphql';
import { Wire } from './wire';
import { Buf, BufRead } from './buf';
import { Path } from 'graphql/jsutils/Path';
import { BlockReader } from './blockReader';
/**
 * Decodes a Argo message into a JavaScript object (ExecutionResult).
 */
export declare class ArgoDecoder {
    readonly messageBuf: Buf;
    private static utf8;
    private static utf8decode;
    private readers;
    private slicer;
    DEBUG: boolean;
    tracked: any[];
    counts: Map<string, number>;
    track: (path: Path | undefined, msg: string, buf: BufRead, value: any) => void;
    count: (key: string, amnt?: number) => void;
    constructor(messageBuf: Buf);
    /**
     * Decode the Argo message, returning the result as an ExecutionResult
     *
     * @param wt The type of the message, as a Wire.Type
     * @returns The decoded message
     * @throws If the message is invalid for the given type
     */
    argoToJsWithType(wt: Wire.Type): ExecutionResult;
    readArgo: (buf: BufRead, path: Path | undefined, wt: Wire.Type, block?: Wire.BLOCK) => any;
    readSelfDescribing: (buf: BufRead, path: Path | undefined) => any;
    private getBlockReader;
    makeBlockReader(t: Wire.Type, dedupe: boolean): BlockReader<any>;
}
