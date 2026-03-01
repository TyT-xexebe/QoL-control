const modules = [
    "utils",
    "trace",
    "mining",
    "autograb",
    "camera",
    "ai",
    "optimizer",
    "mlog",
    "detector",
    "assist",
    "autofill"
];

for (let module of modules) {
    try {
        require("qol-control/" + module);
    } catch (e) {
        Log.err("QOL-Control: failed to load " + module);
        Log.err(e);
    }
}
