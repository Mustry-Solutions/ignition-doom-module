const path = require('path');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin');

// Bundle name — the gateway serves this at /res/mustry-doom/MustryDoom.js (and .css).
// Must line up with BROWSER_RESOURCES in common/.../MustryDoomModule.java.
const LibName = 'MustryDoom';

module.exports = (env, argv) => ({
    entry: {
        [LibName]: path.join(__dirname, 'typescript/index.ts')
    },
    output: {
        path: path.resolve(__dirname, 'build/generated-resources/mounted'),
        filename: `${LibName}.js`,
        library: [LibName],
        libraryTarget: 'umd',
        umdNamedDefine: true,
        clean: true
    },
    devtool: argv.mode === 'development' ? 'source-map' : false,
    resolve: {
        extensions: ['.ts', '.tsx', '.js', '.jsx', '.css', '.scss']
    },
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                use: { loader: 'ts-loader' },
                exclude: /node_modules/
            },
            {
                test: /\.s?css$/,
                use: [
                    MiniCssExtractPlugin.loader,
                    { loader: 'css-loader', options: { url: false } },
                    { loader: 'sass-loader' }
                ]
            }
        ]
    },
    plugins: [
        new MiniCssExtractPlugin({ filename: `${LibName}.css` })
    ],
    optimization: {
        minimizer: ['...', new CssMinimizerPlugin()]
    },
    // Provided globally by the Perspective runtime; never bundle them.
    externals: {
        'react': 'React',
        'react-dom': 'ReactDOM',
        'mobx': 'mobx',
        'mobx-react': 'mobxReact',
        '@inductiveautomation/perspective-client': 'PerspectiveClient'
    }
});
