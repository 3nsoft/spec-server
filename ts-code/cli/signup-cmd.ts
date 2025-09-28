/*
 Copyright (C) 2023 3NSoft Inc.
 
 This program is free software: you can redistribute it and/or modify it under
 the terms of the GNU General Public License as published by the Free Software
 Foundation, either version 3 of the License, or (at your option) any later
 version.
 
 This program is distributed in the hope that it will be useful, but
 WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 See the GNU General Public License for more details.
 
 You should have received a copy of the GNU General Public License along with
 this program. If not, see <http://www.gnu.org/licenses/>.
*/

import { CliUsageDisplay, CommandDef, HelpArg, OptionDef, UsageSection, helpOpt, parseArgv, toErrorUsage, toUsageDisplay } from "./utils";

export const signupCmd: CommandDef<'signup'> = {
	name: 'signup',
	summary: 'controls adding new users to this instance'
};

function signupUsage(execName: string): UsageSection[] {
	return [
		{
			content: `This command controls parameters of adding new users to this instance.`
		},
		{
			header: 'Usage:',
			content: `${execName} ${signupCmd.name} [command] [options] [config_file]`
		},
		{
			header: 'Available commands:',
			content: [
				infoCmd,
				listTokensCmd,
				showTokenCmd,
				createTokenCmd
			]
		},
		{
			header: `${infoCmd.name} options:`,
			optionList: infoOpts
		},
		{
			header: `${listTokensCmd.name} options:`,
			optionList: listTokensOpts
		},
		{
			header: `${showTokenCmd.name} options:`,
			optionList: showTokenOpts
		},
		{
			header: `${createTokenCmd.name} options:`,
			optionList: createTokenOpts
		}
	];
}

const configOpt: OptionDef = {
	name: 'config',
	alias: 'c',
	type: String,
	typeLabel: '{underline <file>}',
	description: `path of a configuration yaml file`
};

const infoCmd: CommandDef<'info'> = {
	name: 'info',
	summary: 'shows state of signup subsystem'
};

const infoOpts: OptionDef[] = [
	configOpt
];

const listTokensCmd: CommandDef<'list-tokens'> = {
	name: 'list-tokens',
	summary: 'lists signup tokens'
};

const listTokensOpts: OptionDef[] = [
	configOpt
];

const showTokenCmd: CommandDef<'show-token'> = {
	name: 'show-token',
	summary: 'shows signup token with complete value'
};

const showTokenOpts: OptionDef[] = [
	configOpt,
	{
		name: 'token',
		alias: 't',
		type: String,
		typeLabel: '{underline <token_id>}',
		description: `token id`
	}
];

const createTokenCmd: CommandDef<'create-token'> = {
	name: 'create-token',
	summary: 'creates signup token for single user, when user id is given, and for many users, when domain(s) are given'
};

const createTokenOpts: OptionDef[] = [
	configOpt,
	{
		name: 'domain',
		alias: 'd',
		type: String,
		typeLabel: '{underline <domain>}',
		multiple: true,
		description: `domain for new users. Several domain options will attach all domains to same token.`
	},
	{
		name: 'user',
		alias: 'u',
		type: String,
		typeLabel: '{underline <user_address>}',
		description: `address of a single user`
	}
];

export interface ParsedSignupArgs {
	info?: boolean;
	config?: string;
	help?: boolean;
	listTokens?: boolean;
	showToken?: boolean;
	token?: string;
	createToken?: boolean;
	domain?: string[];
	user?: string;
}

function parseWithConfFile(
	args: string[], optList: OptionDef[]
): ParsedSignupArgs|undefined {
	const opts = parseArgv<ParsedSignupArgs>(args, optList, { partial: true });
	if (opts.config) {
		return opts;
	} else if (opts._unknown) {
		opts.config = opts._unknown[0];
		return opts;
	} else {
		return;
	}
}

function cmdUsageErr(
	execName: string, cmd: string, errTxt = `missing configuration file`
): {
	showUsage: CliUsageDisplay;
} {
	return toUsageDisplay(-1, toErrorUsage(
		signupUsage(execName),
		`Incorrect options for command '${signupCmd.name} ${cmd}': ${errTxt}`
	));
}

export function parseSignupArgs(
	args: string[], execName: string
): {
	signupCmd?: ParsedSignupArgs;
	showUsage?: CliUsageDisplay;
} {
	if (args.length === 0) {
		return toUsageDisplay(0, signupUsage(execName));
	}
	if (args[0] === infoCmd.name) {
		const signupCmd = parseWithConfFile(args.slice(1), infoOpts);
		if (signupCmd) {
			signupCmd.info = true;
			return { signupCmd };
		} else {
			return cmdUsageErr(execName, infoCmd.name);
		}
	} else if (args[0] === listTokensCmd.name) {
		const signupCmd = parseWithConfFile(args.slice(1), listTokensOpts);
		if (signupCmd) {
			signupCmd.listTokens = true;
			return { signupCmd };
		} else {
			return cmdUsageErr(execName, listTokensCmd.name);
		}
	} else if (args[0] === showTokenCmd.name) {
		const signupCmd = parseWithConfFile(args.slice(1), showTokenOpts);
		if (signupCmd) {
			if (!signupCmd.token) {
				return cmdUsageErr(
					execName, showTokenCmd.name, `missing token`
				);
			}
			signupCmd.showToken = true;
			return { signupCmd };
		} else {
			return cmdUsageErr(execName, showTokenCmd.name);
		}
	} else if (args[0] === createTokenCmd.name) {
		console.log(args);
		const signupCmd = parseWithConfFile(args.slice(1), createTokenOpts);
		if (signupCmd) {
			if (!signupCmd.domain && !signupCmd.user) {
				return cmdUsageErr(
					execName, createTokenCmd.name, `either user address, or domain(s) should be given`
				);
			}
			signupCmd.createToken = true;
			return { signupCmd };
		} else {
			return cmdUsageErr(execName, createTokenCmd.name);
		}
	} else {
		const opts = parseArgv<HelpArg>(args, [ helpOpt ], { partial: true });
		if (opts.help) {
			return toUsageDisplay(0, signupUsage(execName));
		}
		return toUsageDisplay(-1, toErrorUsage(
			signupUsage(execName),
			`Unknown command '${args[0]}'`
		));
	}
}


Object.freeze(exports);