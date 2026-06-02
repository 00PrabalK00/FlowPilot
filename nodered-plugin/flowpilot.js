// Runtime side of the FlowPilot editor plugin. A do-nothing config node whose only
// job is to make Node-RED load flowpilot.html, which adds the FlowPilot sidebar tab.
module.exports = function (RED) {
  function FlowPilotConfig(n) { RED.nodes.createNode(this, n); }
  RED.nodes.registerType('flowpilot-config', FlowPilotConfig);
};
