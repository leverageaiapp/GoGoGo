#!/usr/bin/env node

import { Command } from 'commander';
import { startSession } from './session';
import * as fs from 'fs';
import * as path from 'path';

// Read version from package.json
const packageJsonPath = path.join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
const version = packageJson.version;

const program = new Command();

program
    .name('gogogo')
    .description('gogogo - Forward your terminal to your mobile device')
    .version(version);

program
    .command('start')
    .description('Start a new gogogo session')
    .argument('[command...]', 'Command to run (default: none, opens terminal only)')
    .option('-n, --name <name>', 'Machine name to display', process.env.HOSTNAME || 'My Computer')
    .action(async (command, options) => {
        console.log('');
        console.log('  🚀 gogogo - Coding anywhere in your pocket');
        console.log('');

        await startSession(options.name, command);
    });

program.parse();
