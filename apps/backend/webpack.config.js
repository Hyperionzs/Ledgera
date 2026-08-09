// Webpack override: bundle @ledgera/shared inline instead of externalizing it.
// nest-cli's default `nodeExternals()` keeps workspace packages as runtime
// require()s, which breaks when the package ships raw TypeScript.
const nodeExternals = require('webpack-node-externals');

module.exports = (config) => {
  const defaultExternals = nodeExternals();
  config.externals = [
    function (ctx, callback) {
      if (
        ctx.request === '@ledgera/shared' ||
        (ctx.request && ctx.request.startsWith('@ledgera/shared/'))
      ) {
        return callback(); // bundle inline
      }
      defaultExternals(ctx.context, ctx.request, callback);
    },
  ];
  return config;
};
