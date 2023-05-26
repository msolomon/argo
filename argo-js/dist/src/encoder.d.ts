import { Label } from './label';
import { Wire } from './wire';
import { Buf, BufWrite } from './buf';
import { Path } from 'graphql/jsutils/Path';
import { Header } from './header';
import { BlockWriter } from './blockWriter';
/**
 * Encodes a JavaScript object (typically ExecutionResult) into a Argo message.
 */
export declare class ArgoEncoder {
    readonly buf: Buf;
    private static utf8;
    private static utf8encode;
    private writers;
    tracked: any[];
    header: Header;
    DEBUG: boolean;
    constructor(buf?: Buf);
    track: (path: Path | undefined, msg: string, buf: BufWrite, value: any) => void;
    log: (msg: string | object) => void;
    getResult(): Buf;
    private static NullTerminator;
    makeBlockWriter(t: Wire.Type, dedupe: boolean): BlockWriter<any>;
    write<T>(block: Wire.BLOCK, t: Wire.Type, v: T): Label | null;
    private getWriter;
    jsToArgoWithType(js: any, wt: Wire.Type): void;
    private writeArgo;
    writeSelfDescribing: (path: Path | undefined, js: any) => void;
}
