import * as path from 'path';
import * as yargs from 'yargs';
import type * as yargstypes from '../node_modules/@types/yargs/index.js';
import createDebug from 'debug';
import DiscordRPC from 'discord-rpc';
import persist from 'node-persist';
import getPaths from 'env-paths';
import { FlapgApiResponse } from './api/f.js';
import { NintendoAccountToken, NintendoAccountUser } from './api/na.js';
import { AccountLogin, CurrentUser, Game } from './api/znc-types.js';
import ZncApi from './api/znc.js';
import titles, { defaultTitle } from './titles.js';
import ZncProxyApi from './api/znc-proxy.js';
import MoonApi from './api/moon.js';

const debug = createDebug('cli');

export const paths = getPaths('nintendo-znc');

export type YargsArguments<T extends yargs.Argv> = T extends yargs.Argv<infer R> ? R : any;
export type Argv<T = {}> = yargs.Argv<T>;
export type ArgumentsCamelCase<T = {}> = yargstypes.ArgumentsCamelCase<T>;

export interface SavedToken {
    uuid: string;
    timestamp: string;
    nintendoAccountToken: NintendoAccountToken;
    user: NintendoAccountUser;
    flapg: FlapgApiResponse['result'];
    nsoAccount: AccountLogin;
    credential: AccountLogin['webApiServerCredential'];

    expires_at: number;
    proxy_url?: string;
}

export interface SavedMoonToken {
    nintendoAccountToken: NintendoAccountToken;
    user: NintendoAccountUser;

    expires_at: number;
}

export async function initStorage(dir: string) {
    const storage = persist.create({
        dir: path.join(dir, 'persist'),
        stringify: data => JSON.stringify(data, null, 4) + '\n',
    });
    await storage.init();
    return storage;
}

export async function getToken(storage: persist.LocalStorage, token: string, proxy_url?: string) {
    if (!token) {
        console.error('No token set. Set a Nintendo Account session token using the `--token` option or by running `nintendo-znc token`.');
        throw new Error('Invalid token');
    }

    const existingToken: SavedToken | undefined = await storage.getItem('NsoToken.' + token);

    if (!existingToken || existingToken.expires_at <= Date.now()) {
        console.warn('Authenticating to Nintendo Switch Online app');
        debug('Authenticating to znc with session token');

        const {nso, data} = proxy_url ?
            await ZncProxyApi.createWithSessionToken(proxy_url, token) :
            await ZncApi.createWithSessionToken(token);

        const existingToken: SavedToken = {
            ...data,
            expires_at: Date.now() + (data.credential.expiresIn * 1000),
        };

        await storage.setItem('NsoToken.' + token, existingToken);
        await storage.setItem('NintendoAccountToken.' + data.user.id, token);

        return {nso, data: existingToken};
    }

    debug('Using existing token');
    await storage.setItem('NintendoAccountToken.' + existingToken.user.id, token);

    return {
        nso: proxy_url ?
            new ZncProxyApi(proxy_url, token) :
            new ZncApi(existingToken.credential.accessToken),
        data: existingToken,
    };
}

export async function getPctlToken(storage: persist.LocalStorage, token: string) {
    if (!token) {
        console.error('No token set. Set a Nintendo Account session token using the `--token` option or by running `nintendo-znc pctl users add`.');
        throw new Error('Invalid token');
    }

    const existingToken: SavedMoonToken | undefined = await storage.getItem('MoonToken.' + token);

    if (!existingToken || existingToken.expires_at <= Date.now()) {
        console.warn('Authenticating to Nintendo Switch Parental Controls app');
        debug('Authenticating to pctl with session token');

        const {moon, data} = await MoonApi.createWithSessionToken(token);

        const existingToken: SavedMoonToken = {
            ...data,
            expires_at: Date.now() + (data.nintendoAccountToken.expires_in * 1000),
        };

        await storage.setItem('MoonToken.' + token, existingToken);
        await storage.setItem('NintendoAccountToken-pctl.' + data.user.id, token);

        return {moon, data: existingToken};
    }

    debug('Using existing token');
    await storage.setItem('NintendoAccountToken-pctl.' + existingToken.user.id, token);

    return {
        moon: new MoonApi(existingToken.nintendoAccountToken.access_token!, existingToken.user.id),
        data: existingToken,
    };
}

export function getTitleIdFromEcUrl(url: string) {
    const match = url.match(/^https:\/\/ec\.nintendo\.com\/apps\/([0-9a-f]{16})\//);
    return match?.[1] ?? null;
}

export function getDiscordPresence(game: Game, friendcode?: CurrentUser['links']['friendCode']): {
    id: string;
    title: string | null;
    presence: DiscordRPC.Presence;
    showTimestamp?: boolean;
} {
    const titleid = getTitleIdFromEcUrl(game.shopUri);
    const title = titles.find(t => t.id === titleid) || defaultTitle;

    const text = [];

    if (title.titleName === true) text.push(game.name);
    else if (title.titleName) text.push(title.titleName);

    if (game.sysDescription) text.push(game.sysDescription);

    if (game.totalPlayTime >= 60) {
        text.push('Played for ' + hrduration(game.totalPlayTime) +
            ' since ' + new Date(game.firstPlayedAt * 1000).toLocaleDateString('en-GB'));
    }

    return {
        id: title.client || defaultTitle.client,
        title: titleid,
        presence: {
            details: text[0],
            state: text[1],
            largeImageKey: title.largeImageKey ?? game.imageUri,
            largeImageText: friendcode ? 'SW-' + friendcode.id : undefined,
            smallImageKey: title.smallImageKey,
            buttons: game.shopUri ? [
                {
                    label: 'Nintendo eShop',
                    url: game.shopUri,
                },
            ] : [],
        },
        showTimestamp: title.showTimestamp,
    };
}

export interface Title {
    /** Lowercase hexadecimal title ID */
    id: string;
    /** Discord client ID */
    client: string;

    titleName?: string | true;
    largeImageKey?: string;
    smallImageKey?: string;
    showTimestamp?: boolean;
}

export function hrduration(duration: number, short = false) {
    const hours = Math.floor(duration / 60);
    const minutes = duration - (hours * 60);

    const hour_str = short ? 'hr' : 'hour';
    const minute_str = short ? 'min' : 'minute';

    if (hours >= 1) {
        return hours + ' ' + hour_str + (hours === 1 ? '' : 's') +
            (minutes ? ', ' + minutes + ' ' + minute_str + (minutes === 1 ? '' : 's') : '');
    } else {
        return minutes + ' ' + minute_str + (minutes === 1 ? '' : 's');
    }
}
