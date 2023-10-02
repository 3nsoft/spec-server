
function is(it) {
	return !!it && it !== '0' && it !== 'false';
}
 
const env = process.env;

const ADBLOCK = is(env.ADBLOCK);
const SILENT = ['silent', 'error', 'warn'].includes(env.npm_config_loglevel) ;
const COLOR = is(env.npm_config_color);

const BANNER = `\u001B[96mThank you for using spec-server (\u001B[94m https://github.com/3nsoft/spec-server.git \u001B[96m) of 3NWeb uitlity services. This server is developed together with defining 3NWeb protocols by PrivacySafe\u001B[0m

\u001B[96mThe project needs your help! Please consider supporting PrivacySafe on Open Collective: \u001B[0m
\u001B[96m>\u001B[94m https://opencollective.com/privacysafe \u001B[0m
`;

function isBannerRequired() {
  if (ADBLOCK || SILENT) { return false; }
  return true;
}

if (isBannerRequired()) {
	console.log(COLOR ? BANNER : BANNER.replace(/\u001B\[\d+m/g, ''));
}
