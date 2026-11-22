const reactNative = require('@react-native/eslint-config/flat');

module.exports = [
    { ignores: ['android/**', 'core/target/**', 'ios/Pods/**', 'ios/build/**', 'studio/**', 'temp/**'] },
    ...reactNative,
    { rules: { 'ft-flow/define-flow-type': 'off', 'ft-flow/use-flow-type': 'off' } },
];
