/*
 Copyright (C) 2025 3NSoft Inc.
 
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

import { CommandDef } from "./utils";


export const showSampleConfigCmd: CommandDef<'show-sample-config'> = {
	name: 'show-sample-config',
	summary: 'prints out a template configuration yaml file with comments'
};

export const sampleConfig = `
# This is a sample configuration yaml file.
# Uncomment and set required values.
# Default path of this file is /etc/3nweb/conf.yaml

# Uncomment to enable service
enabledServices:
  # asmail: true
  # storage: true
  # mailerId: true

# Data root folder. Set non-default value, if required.
# rootFolder: /var/3nweb

# Customize domain at which clients reach this server from an outside.
# This value is used by users' MailerId-based login: assertion challenges
# cryptographically imprint this domain to assure client that there is no
# missuse.
domain: service-for.example.com

# If MailerId provider service is enabled, this is its configuration
mailerId:
  certs: /etc/3nweb/mailerid/certs

# Customize servicesConnect before starting this server.
servicesConnect:

  port: 7070
  # Hostname allows to restrict on which address service is listening for incoming connections
  # hostname: "1.2.3.4"

  # Uncomment path to Let's Encrypt folder, if it is used. This implicitly tells
  # server to HTTPS with given certificates.
  # letsencrypt: /etc/letsencrypt/live/service-for.example.com

  # By default HTTPS service reloads when certificates change. Skip, if required.
  # skipReloadOnCertsChange: false

  # Set TLS cert and key to do HTTPS. Use either this, or letsencrypt, but not both.
  # sslOpts: {
  #   It is Node's https.ServerOptions. Follow https://nodejs.org/docs/latest/api/https.html
  # }

# Configuration for signup service that creates new accounts on this server.
# Comment out to disable signup service completely.
# Note that signup cli commands should be used to create token, without which
# signup doesn't happen, unless a no-token configuration file is provided.
signup: {
  # noTokenFile: /some/path/to/json
}
`;

Object.freeze(exports);