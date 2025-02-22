/*
 Copyright (C) 2016 3NSoft Inc.
 
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

import { ServerOptions } from "https";

export const sslOpts: ServerOptions = {
	key: `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDNSnmGLUwA7Qf9
D2cqOq4fvhRcO07/C5PLjbEzIg311caqfU7bUlit90vBFB7TvHg/cKORTXPJb/SQ
D9pR+Sq2zXKjweScUwdza0f+12D3bAbD1ntHQD+4Fh2QaR34LRP1yaPKI5u2kBwb
6R0qaAuaj3VQ1ttVz7zEwERBtSWJD8r8kj9TGKqNC82LPdcGsFeNsobNE30K/3z8
uqEyLm+AN6FJ1u9ahLxdA3Fn9kLVtOrmskpFcZY9ECauK+DUwWVYI7t9+37EwCcl
ENsw+i2dPUHoPVPsOqsW2aXAH2meSx0jE2sjdccgFA86nHfuBdx+0o3MoIe12ZbF
/v64nvS9AgMBAAECggEAV0hK0tl/bwVYWCesXTAFyEkwruYoeBecBvd/V5YrCVKS
3PnaBTXFrnFuK/E6ChwfpBln8edUS1jmSjnzQNcHaiF/lFBjunMyv8flHFzGRWwQ
lEMktu6CKOp+N1/59gJ0chQBJ3hsQ/qReOxsEhOam2RTJMO1DY79W0nDu4whIVxp
wMpn/RlSdOkBwDzVvnazpZPLOFiUDcd+MNfR1Z0gzgMxfwQvvXseHe21x8qwpBFD
L1D6jfu1D8ku03TiKq2MHjS7p8oFKeGFo7p3G8LJG5yrzrP8fqCRE6E5zsunFo48
zgZwt0kuKcM8Fy5X5MSs8q67TS4sWPTULzUG/suaAQKBgQD8dXGHvY47KbB3+4xa
SLrtXry1AQho/iJ8skm02C9XRZLopS6fdzC95GSRTRZa8mAjCOrnxwXKYyjUqWGt
vDJqKRn1IOfwXmvdJ7Wp94N/b0i5WBkxNhR99JXyPmvGt0R7Ym6bDh7YIdGp5Je4
t1oaWizkyr5t3cKxkNaz8tqUrQKBgQDQK6fgTr+UX/GnWu7zom3JxHbN7+BVoJC+
zKCsbiUbzT0qG066J0oJ2qJejDUDwYD2BNevPLppxTFY9WTwSeEqQz4pxHBEfxxc
K129HGnrkQ2s/Ow/DvbFiLO9D7oM3nN0SlpLqFJmZ0cem2FKsAz7oD10tohFJL0t
pDRc0YDSUQKBgQCcxHETUWoY4vJqDxJAnhk1fTbBTzrht63CsROD8Rq0nsdzH9+r
tl/WCxVIBQ50uz1nhAoak0PNQXYBWI0HTW4g7hToWt6sLHXehuIQAVrurzQBo+tA
28wtysux+YEDjJpB5AW60zHkFFwVm5V7Zp/U7VojWKKXprVXfhFU/OEuoQKBgQCg
ne5rjZcX3mdP30ObS+o10ZZxEvIeX0MPVEdsg5eyOctFn8hArWvc6op5NOj6uuTL
7bSVCuAyF+oZX03AcOCAgV2HUH/m+cRiATvUXAYFsefBX2zQwrT4eJ9l8qp0n3ap
dWzyDy90v58KKI0K2YdK5rpEQUonP0+P1bBpJWSl4QKBgCs0tN/qzx9IzoOwZwVQ
UASKANPksnyfD7f/YrV82mCHX4GcKtqkf/nneM3kajU0UhR9iZ0lfftIQ4Es0um2
CMvkrvDxiv0YpIOluhCIrEPN/p+yn/uQ2hf5pSuQ4AL78sONub8sKixcutw3V8Gh
ekdV13TrfP1PK28L4KE47V4p
-----END PRIVATE KEY-----`,
	cert: `-----BEGIN CERTIFICATE-----
MIIDRTCCAi2gAwIBAgIJAMt7Y3ydmYQ3MA0GCSqGSIb3DQEBCwUAMDkxCzAJBgNV
BAYTAiAgMQowCAYDVQQIDAEgMQowCAYDVQQKDAEgMRIwEAYDVQQDDAlsb2NhbGhv
c3QwHhcNMTYwNjExMjIwMDE4WhcNMjYwNjA5MjIwMDE4WjA5MQswCQYDVQQGEwIg
IDEKMAgGA1UECAwBIDEKMAgGA1UECgwBIDESMBAGA1UEAwwJbG9jYWxob3N0MIIB
IjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAzUp5hi1MAO0H/Q9nKjquH74U
XDtO/wuTy42xMyIN9dXGqn1O21JYrfdLwRQe07x4P3CjkU1zyW/0kA/aUfkqts1y
o8HknFMHc2tH/tdg92wGw9Z7R0A/uBYdkGkd+C0T9cmjyiObtpAcG+kdKmgLmo91
UNbbVc+8xMBEQbUliQ/K/JI/UxiqjQvNiz3XBrBXjbKGzRN9Cv98/LqhMi5vgDeh
SdbvWoS8XQNxZ/ZC1bTq5rJKRXGWPRAmrivg1MFlWCO7fft+xMAnJRDbMPotnT1B
6D1T7DqrFtmlwB9pnksdIxNrI3XHIBQPOpx37gXcftKNzKCHtdmWxf7+uJ70vQID
AQABo1AwTjAdBgNVHQ4EFgQUWi2JgyaWzw0xNLoGjdlzaj1EzAIwHwYDVR0jBBgw
FoAUWi2JgyaWzw0xNLoGjdlzaj1EzAIwDAYDVR0TBAUwAwEB/zANBgkqhkiG9w0B
AQsFAAOCAQEALuiVV78gNhaiDyWuwzDsbRrXVLXd7kOLLXhE/JBEUaQC7pJGKLVe
Vdq8XS41+6/gIPq+Q5EF7Ci9Krct5Zmnvd/6cbvN1CT1E8efjwvMhQFSi3QbUpbT
y/IIkOQk3mqBXced0Wj7V7drqb9Q2U6bRZ5WA/w6jtxMtQctAyvyFdffyaGQBPCe
VMZHQcXuoAdQpr2WKlwIkTx34G7d+0Qv3NpbjBwKmwT56qNwb5cZ0YqMIg+TBoy0
BvLR2f2eEfMj927ACiBdJ6d+1Mdl7+wZJKb+gPQPO3h2T90m+dGuWw+jZ9Qs9XLN
YzorNrzZ9NOKKFrYjXHyXQByeGgoltk/8w==
-----END CERTIFICATE-----`
};

Object.freeze(exports);