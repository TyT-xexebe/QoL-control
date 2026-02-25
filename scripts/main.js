const modules = [
    "utils",
    "trace",
    "mining",
    "autograb",
    "camera",
    "ai",
    "optimizer"
];

for (let module of modules) {
    try {
        require("qol-control/" + module);
    } catch (e) {
        Log.err("QOL-Control: failed to load " + module);
        Log.err(e);
    }
}
