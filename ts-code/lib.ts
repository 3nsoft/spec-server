/*
 Copyright (C) 2020, 2023 3NSoft Inc.
 
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

export { AppWithWSs } from './lib-server/web-sockets/app';

export { Configurations, servicesApp, adminApp } from './services';

export { addSingleUserSignup, getConfsFromEnv, getBindParamsFromEnv } from './run-config';

export import errors = require('./lib-server/middleware/error-handler');

export * as mock from './mock/run-in-proc';


Object.freeze(exports);