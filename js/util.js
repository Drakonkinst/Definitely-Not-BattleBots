function debug(msg, condition) {
    condition = condition || true;
    if(condition) {
        console.log(msg);
    }
}