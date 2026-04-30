function formatTime(timeInSeconds) {
    const minutes = Math.floor(timeInSeconds / 60);
    const seconds = timeInSeconds % 60;
    return (`0${minutes}`).slice(-2) + ":" + (`0${seconds}`).slice(-2);
}

function getRanges(timeString, n) {
    const totalTimeInSeconds = parseInt(timeString.split(":")[0], 10) * 60
        + parseInt(timeString.split(":")[1], 10);

    if (n >= totalTimeInSeconds) {
        return [timeString];
    }

    const rangeDurationInSeconds = Math.ceil(totalTimeInSeconds / n);
    const ranges = ["00:00"];

    let end = rangeDurationInSeconds;
    while (end < totalTimeInSeconds) {
        ranges.push(formatTime(end));
        end += rangeDurationInSeconds;
    }

    ranges.push(formatTime(totalTimeInSeconds));

    return ranges;
}

module.exports = {
    getRanges
};
