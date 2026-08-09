// Webpack override: bundle @nexuspos/shared inline instead of externalizing it.
// nest-cli's default `nodeExternals()` keeps workspace packages as runtime
// require()s, which breaks when the package ships raw TypeScript.
const nodeExternals = require('webpack-node-externals');

module.exports = (config) => {
  const defaultExternals = nodeExternals();
  config.externals = [
    function (ctx, callback) {
      if (
        ctx.request === '@nexuspos/shared' ||
        (ctx.request && ctx.request.startsWith('@nexuspos/shared/'))
      ) {
        return callback(); // bundle inline
      }
      defaultExternals(ctx.context, ctx.request, callback);
    },
  ];
  return config;
};
