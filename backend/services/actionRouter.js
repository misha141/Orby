const { executeLegacyAction } = require('../tools/toolRegistry');

async function executeAction(command = {}) {
  return executeLegacyAction(command);
}

module.exports = {
  executeAction
};
