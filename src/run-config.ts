/*
 Copyright (C) 2019 3NSoft Inc.
 
 This program is free software: you can redistribute it and/or modify it under
 the terms of the GNU General Public License as published by the Free Software
 Foundation, either version 3 of the License, or (at your option) any later
 version.
 
 This program is distributed in the hope that it will be useful, but
 WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 See the GNU General Public License for more details.
 
 You should have received a copy of the GNU General Public License along with
 this program. If not, see <http://www.gnu.org/licenses/>. */

import { Configurations } from "./services";
import { existsFolderSync } from './lib-common/async-fs-node';
import { join } from "path";
import { realpathSync, mkdirSync } from "fs";
import { ServerOptions } from "https";

const DOMAIN_VAR = 'W3N_DOMAIN';
const DATA_DIR_VAR = 'W3N_DATA_DIR';
const CERTS_FILE_VAR = 'W3N_MID_CERTS_FILE';
const ADDRESS_VAR = 'W3N_SERICE_ADDRESS';
const PORT_VAR = 'W3N_SERICE_PORT';
const TLS_KEY_VAR = 'W3N_SERICE_TLS_KEY';
const TLS_CERT_VAR = 'W3N_SERICE_TLS_CERT';
const TLS_PFX_VAR = 'W3N_SERICE_TLS_PFX';

const DEFAULT_PORT = 8080;

function makeConf(domain: string, rootFolder: string, midCertsFile: string):
		Configurations {
	return {
		enabledServices: {
			asmail: true,
			storage: true,
			mailerId: true
		},
		rootFolder,
		domain,
		mailerId: {
			certs: midCertsFile
		},
		signup: {
			domains: [ domain ]
		}
	}
}

export function getConfsFromEnv(): Configurations {
	const domain = process.env[DOMAIN_VAR];
	if (!domain) { throw new Error(
		`Environment variable ${DOMAIN_VAR} is not set with domain name, for which 3NWeb processes are served.`); }
	let dataDir = process.env[DATA_DIR_VAR];
	if (!dataDir) {
		dataDir = '/var/local/3nweb';
	}

	// Make data folders
	ensureFolderPresence(dataDir, true);
	dataDir = realpathSync(dataDir);
	const rootFolder = join(dataDir, 'users');
	ensureFolderPresence(rootFolder, true);

	let midCerts = process.env[CERTS_FILE_VAR];
	if (!midCerts) {
		midCerts = join(dataDir, 'mid-certs.json');
	}

	return makeConf(domain, rootFolder, midCerts);
}

function ensureFolderPresence(path: string, doLog?: boolean): void {
	if (existsFolderSync(path)) {
		if (doLog) { console.log(`Using existing data folder ${path}`); }
	} else {
		mkdirSync(path);
		if (doLog) { console.log(`Created ${realpathSync(path)}`); }
	}
}

export function getBindParamsFromEnv():
		{ address?: string; port: number; sslOpts?: ServerOptions; } {
	const address = process.env[ADDRESS_VAR];
	const portStr = process.env[PORT_VAR];
	let port: number;
	if (portStr) {
		port = Number.parseInt(portStr);
		if (!Number.isInteger(port)) {
			port = DEFAULT_PORT;
		}
	} else {
		port = DEFAULT_PORT;
	}
	const sslOpts = getTLSParamsFromEnv();
	return { address, port, sslOpts };
}

function getTLSParamsFromEnv(): ServerOptions|undefined {
	const pfx = process.env[TLS_PFX_VAR];
	if (pfx) {
		return { pfx };
	}
	const cert = process.env[TLS_CERT_VAR];
	const key = process.env[TLS_KEY_VAR];
	if (cert && key) {
		return { cert, key };
	} else if (!cert && !key) {
		return;
	} else {
		throw new Error(`Both ${TLS_CERT_VAR} and ${TLS_KEY_VAR} environment parameters should be present, but one is missing.`);
	}
}

Object.freeze(exports);