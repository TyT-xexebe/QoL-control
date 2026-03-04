module.exports = {
    notify: function(text) {
        Vars.ui.chatfrag.addMessage("[#eab678][QoL][]\n" + text);
    },
    info: function(text) {
        Log.info("[QoL] " + text);
    },
    err: function(text) {
        Log.err("[QoL Error] " + text);
    }
};
