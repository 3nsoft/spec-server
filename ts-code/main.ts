#!/usr/bin/env node

/*
 Copyright (C) 2015 - 2016, 2019, 2025 3NSoft Inc.
 
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

/*
 * This script starts server, according to settings, given in config file.
 */

import { ServerOptions } from 'https';
import { CliUsageDisplay, parseProcessArgv } from './cli';
import { readYamlConfFile } from './config/from-yaml';
import { sslOptsFromConfig } from './config/letsencrypt';
import { Configurations, servicesApp, accountsApp, AppWithWSs } from './lib';
import { addMultiDomainSignup, addSingleUserSignup, readAllSignupTokens, readNoTokensFile, readTokenFile } from './config/signup';
import { DEFAULT_CONFIG_PATH } from './config/default-confs';
import { Code } from './lib-common/exceptions/file';

async function run(conf: Configurations): Promise<void> {

	if (!conf.servicesConnect) {
		console.error(`❌ No connection settings found in configuration.`);
		process.exit(-1);
		return;
	}

	let app: AppWithWSs|undefined = undefined;

	function createApp(conf: Configurations): AppWithWSs {
		const app = new AppWithWSs();
		app.use(servicesApp(conf, 'console', 'console'));
		app.use(accountsApp(conf, 'console', 'console'));
		return app;
	}

	async function stopProcess() {
		if (!app) { return; }
		try {
			console.log(`🏁 Stopping app ...`);
			await app.stop();
			console.log(`app has stopped.`);
		} catch (err) {
			console.log(`app encounter an error, when stopping`);
			console.error(err);
		} finally {
			app = undefined;
		}
	}

	async function startAppWithTLS(
		sslOpts: ServerOptions, port: number, hostname: string|undefined
	): Promise<void> {
		await app!.start(sslOpts, port, hostname);
		console.log(`🚀 Started 3NWeb server on port ${port},${hostname ? ` hostname ${hostname},` : ''} with TLS.`);
	}

	async function startAppWithoutTLS(
		port: number, hostname: string|undefined
	): Promise<void> {
		await app!.start(undefined, port, hostname);
		console.log(`🚀 Started 3NWeb server on port ${port},${hostname ? ` hostname ${hostname},` : ''} without TLS, and requiring TLS reverse proxy infront.`);	
	}

	try {

		app = createApp(conf);

		const {
			hostname, port, letsencrypt, sslOpts, skipReloadOnCertsChange
		} = conf.servicesConnect;
		const tls = sslOptsFromConfig(
			letsencrypt, sslOpts, skipReloadOnCertsChange
		);
		if (tls) {
			await startAppWithTLS(tls.sslOpts, port, hostname);
			if (!skipReloadOnCertsChange) {
				tls.onCertsUpdate!(async (newOpts, originalOpts) => {
					console.log(`🗘  Reloading server app server on TLS certificates change`);
					try {
						await stopProcess();
						app = createApp(conf);
						await startAppWithTLS(newOpts, port, hostname);
					} catch (err) {
						console.error(err);
						console.log(`⚠️  Failed to reload with new TLS certs. Attempting to load with original ones.`);
						try {
							await stopProcess();
							app = createApp(conf);
							await startAppWithTLS(originalOpts, port, hostname);
						} catch (err) {
							await stopProcess();
							console.error(err);
							process.exit(-500);					
						}
					}
				});
			}
		} else {
			await startAppWithoutTLS(port, hostname);
		}

		process.on('SIGINT', stopProcess);
		process.on('SIGTERM', stopProcess);

	} catch (err) {
		await stopProcess();
		console.error(err);
		process.exit(-500);
	}
}

function showUsage({ txtToDisplay, exitStatus }: CliUsageDisplay): void {
	if (exitStatus === 0) {
		console.log(txtToDisplay);
	} else {
		console.error(txtToDisplay);
	}
	process.exit(exitStatus);
}

function assembleConfig(configPath: string|undefined): Configurations {
	if (!configPath) {
		configPath = DEFAULT_CONFIG_PATH;
		console.log(`Looking for configuration in default location: ${configPath}`);
	}
	try {
		return readYamlConfFile(configPath);
	} catch (err) {
		if (err.code === Code.notFound) {
			console.error(`❌ Configuration file ${configPath} is not found.`);
			process.exit(-2);
		}
		throw err;
	}
}

async function displaySignupInfo(conf: Configurations): Promise<void> {
	if (!conf.signup) {
		console.log(`\nSignup is disabled.\n`);
	} else {
		console.log(`\nSignup is enabled.\n`);
		if (conf.signup.noTokenFile) {
			const ctx = await readNoTokensFile(conf.signup.noTokenFile);
			console.log(`Signup of user without token is allowed in domains:\n`, ctx.domains, `\n`);
		} else {
			console.log(`Signup of users is allowed only with valid signup tokens.\n`);
		}
	}
	const {
		multiUserTokens, singleUserTokens
	} = await readAllSignupTokens(conf.rootFolder);
	console.log(`There are ${multiUserTokens.length} multi-user tokens.\n`);
	console.log(`There are ${singleUserTokens.length} single-user tokens.\n`);
}

async function displayTokensList(conf: Configurations): Promise<void> {
	const {
		multiUserTokens, singleUserTokens
	} = await readAllSignupTokens(conf.rootFolder);
	if (multiUserTokens.length > 0) {
		console.log(`\nMulti-user signup tokens:`);
		for (const { tokenId, ctx: { domains } } of multiUserTokens) {
			console.log(`  id: ${tokenId}  -> domains:`, domains);
		}
		console.log(``);
	} else {
		console.log(`\nThere are no multi-user signup tokens.\n`);
	}
	if (singleUserTokens.length > 0) {
		console.log(`Single-user signup tokens:`);
		for (const { tokenId, ctx: { userId } } of singleUserTokens) {
			console.log(`  id: ${tokenId}  -> user: ${userId}`);
		}
		console.log(``);
	} else {
		console.log(`There are no single-user signup tokens.\n`);
	}
}

async function displayTokenValue(
	conf: Configurations, tokenId: string
): Promise<void> {
	const ctx = await readTokenFile(conf.rootFolder, tokenId);
	if (!ctx) {
		console.error(`Token ${tokenId} is not found.`);
		process.exit(-1);
	} else if (ctx.type === 'multi-domain') {
		console.log(`\nMulti-user signup context:`);
		console.log(`  domains:`, ctx.domains);
		console.log(`  value:`, ctx.token);
		if (ctx.validTill) {
			console.log(`  valid till: ${(new Date(ctx.validTill)).toString()}\n`);
		} else {
			console.log(``);
		}
	} else if (ctx.type === 'single-user') {
		console.log(`\nSingle-user signup context:`);
		console.log(`  address:`, ctx.userId);
		console.log(`  value:`, ctx.token);
		if (ctx.validTill) {
			console.log(`  valid till: ${(new Date(ctx.validTill)).toString()}\n`);
		} else {
			console.log(``);
		}
	}
}

async function createMultiUserToken(
	conf: Configurations, domains: string[]
): Promise<void> {
	const token = await addMultiDomainSignup(conf.rootFolder, domains);
	console.log (`\nToken value:\n  ${token}\n`);
}

async function createSingleUserToken(
	conf: Configurations, userId: string
): Promise<void> {
	const token = await addSingleUserSignup(conf.rootFolder, userId);
	console.log (`\nToken value:\n  ${token}\n`);
}

const cmd = parseProcessArgv();

if (cmd.runCmd) {
	const conf = assembleConfig(cmd.runCmd.config!);
	run(conf);
} else if (cmd.signupCmd) {
	const conf = assembleConfig(cmd.signupCmd.config!);
	if (cmd.signupCmd.info) {
		displaySignupInfo(conf);
	} else if (cmd.signupCmd.listTokens) {
		displayTokensList(conf);
	} else if (cmd.signupCmd.showToken) {
		displayTokenValue(conf, cmd.signupCmd.token!);
	} else if (cmd.signupCmd.createToken) {
		if (cmd.signupCmd.user) {
			createSingleUserToken(conf, cmd.signupCmd.user!);
		} else {
			createMultiUserToken(conf, cmd.signupCmd.domain!);
		}
	} else {
		showUsage({
			txtToDisplay: `❌ No recognized subcommand given to signup module`,
			exitStatus: -1
		});
	}
} else if (cmd.showSampleConfig) {
	showUsage(cmd.showSampleConfig);
} else if (cmd.showUsage) {
	showUsage(cmd.showUsage);
} else {
	showUsage({
		txtToDisplay: `❌ No recognized command given`,
		exitStatus: -1
	});
}
