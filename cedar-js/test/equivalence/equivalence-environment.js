const NodeEnvironment = require('jest-environment-node').TestEnvironment;

class CustomEnvironment extends NodeEnvironment {
    constructor(config, context) {
        super(config, context)
        this.global.testPath = context.testPath
    }
}

module.exports = CustomEnvironment
