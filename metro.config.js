const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const apiPath = path.join(__dirname, 'apps/api').replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');

config.resolver.blockList = [
  /(?:^|[\\/])apps[\\/]api[\\/].*/,
  new RegExp(`${apiPath}/.*`),
];

module.exports = config;
