// Fish servers ohno's unit leave
Events.on(UnitChangeEvent, e => {
    if (e.player === Vars.player && e.unit && e.unit.type === UnitTypes.alpha && e.unit instanceof Legsc) e.player.clearUnit()
});
