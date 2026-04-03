const interceptor = require("qol-control/core/interceptor");

const mColor = Packages.arc.graphics.Color;
const mTex = Packages.mindustry.gen.Tex;
const mCore = Packages.arc.Core;
const mIcon = Packages.mindustry.gen.Icon;
const mStyles = Packages.mindustry.ui.Styles;
const mTable = Packages.arc.scene.ui.layout.Table;
const mBaseDialog = Packages.mindustry.ui.dialogs.BaseDialog;
const mScrollPane = Packages.arc.scene.ui.ScrollPane;
const mImage = Packages.arc.scene.ui.Image;
const mTextField = Packages.arc.scene.ui.TextField;
const mImageButton = Packages.arc.scene.ui.ImageButton;

const PREFIX = "qol-pal-";
let colors = [];
let initialized = false;

const isHex = str => {
    if (str.length !== 6 && str.length !== 8) return false;
    for (let i = 0; i < str.length; i++) {
        let c = str.charCodeAt(i);
        if (!(c >= 48 && c <= 57) && !(c >= 65 && c <= 70) && !(c >= 97 && c <= 102)) return false;
    }
    return true;
};

const initColors = () => {
    if (initialized && colors.length > 0) return;
    try {
        let loader = Vars.ui.getClass().getClassLoader();
        let palClass = java.lang.Class.forName("mindustry.graphics.Pal", true, loader);
        let colorClass = java.lang.Class.forName("arc.graphics.Color", true, loader);
        let fields = palClass.getDeclaredFields();
        
        colors = [];
        for (let i = 0; i < fields.length; i++) {
            let f = fields[i];
            if (f.getType().equals(colorClass)) {
                f.setAccessible(true);
                let obj = f.get(null);
                let name = String(f.getName());
                let def = String(obj.toString());
                
                let saved = mCore.settings.getString(PREFIX + name, null);
                if (saved) {
                    try { obj.set(mColor.valueOf(saved)); } catch(e) {}
                }
                
                colors.push({ name: name, obj: obj, def: def });
            }
        }
        colors.sort((a, b) => a.name.localeCompare(b.name));
        initialized = true;
    } catch(e) {}
};

if (Vars.ui) initColors();
Events.on(ClientLoadEvent, initColors);

interceptor.add("colors", () => {
    if (!initialized || colors.length === 0) {
        initColors();
    }
    
    if (colors.length === 0) return;

    let dialog = new mBaseDialog("Custom Colors");
    dialog.addCloseButton();
    
    let mainTable = new mTable();
    let scroll = new mScrollPane(mainTable);
    
    colors.forEach(c => {
        let row = new mTable();
        let img = new mImage(mTex.whiteui);
        img.setColor(c.obj);
        
        let tf = new mTextField(String(c.obj.toString()));
        tf.setMaxLength(8);
        tf.changed(() => {
            let text = String(tf.getText());
            if (isHex(text)) {
                try {
                    c.obj.set(mColor.valueOf(text));
                    img.setColor(c.obj);
                    mCore.settings.put(PREFIX + c.name, text);
                } catch(e) {}
            }
        });
        
        row.add(c.name).width(180).padRight(10).left();
        row.add(tf).width(120).padRight(10);
        row.add(img).size(32).padRight(10);
        
        let btn = new mImageButton(mIcon.cancel, mStyles.clearNonei);
        btn.clicked(() => {
            c.obj.set(mColor.valueOf(c.def));
            img.setColor(c.obj);
            tf.setText(c.def);
            mCore.settings.remove(PREFIX + c.name);
        });
        row.add(btn).size(32);
        
        mainTable.add(row).row();
    });
    
    dialog.cont.add(scroll).width(450).height(mCore.graphics.getHeight() * 0.65).padTop(20).padBottom(20);
    dialog.show();
});
