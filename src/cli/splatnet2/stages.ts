import Table from '../util/table.js';
import type { Arguments as ParentArguments } from '../splatnet2.js';
import createDebug from '../../util/debug.js';
import { ArgumentsCamelCase, Argv, YargsArguments } from '../../util/yargs.js';
import { initStorage } from '../../util/storage.js';
import { getIksmToken } from '../../common/auth/splatnet2.js';

const debug = createDebug('cli:splatnet2:stages');

export const command = 'stages';
export const desc = 'List stages';

export function builder(yargs: Argv<ParentArguments>) {
    return yargs.option('user', {
        describe: 'Nintendo Account ID',
        type: 'string',
    }).option('token', {
        describe: 'Nintendo Account session token',
        type: 'string',
    }).option('json', {
        describe: 'Output raw JSON',
        type: 'boolean',
    }).option('json-pretty-print', {
        describe: 'Output pretty-printed JSON',
        type: 'boolean',
    });
}

type Arguments = YargsArguments<ReturnType<typeof builder>>;

export async function handler(argv: ArgumentsCamelCase<Arguments>) {
    const storage = await initStorage(argv.dataPath);

    const usernsid = argv.user ?? await storage.getItem('SelectedUser');
    const token: string = argv.token ||
        await storage.getItem('NintendoAccountToken.' + usernsid);
    const {splatnet} = await getIksmToken(storage, token, argv.zncProxyUrl, argv.autoUpdateSession);

    const stages = await splatnet.getStages();

    if (argv.jsonPrettyPrint) {
        console.log(JSON.stringify(stages, null, 4));
        return;
    }
    if (argv.json) {
        console.log(JSON.stringify(stages));
        return;
    }

    const table = new Table({
        head: [
            'ID',
            'Name',
        ],
    });

    stages.stages.sort((a, b) => parseInt(a.id) > parseInt(b.id) ? 1 : parseInt(a.id) < parseInt(b.id) ? -1 : 0);

    for (const stage of stages.stages) {
        table.push([
            stage.id,
            stage.name,
        ]);
    }

    console.log(table.toString());
}
