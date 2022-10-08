export function compareVersions(version1: string, version2: string) {
    const version1Parts = version1.split(".");
    const version2Parts = version2.split(".");

    for (let i = 0; i < 3; i++) {
        const part1 = parseInt(version1Parts[i]);
        const part2 = parseInt(version2Parts[i]);

        if (part1 > part2)
            return (part2 - part1) * Math.pow(10, (2 - i) * 2);
        else if (part1 < part2)
            return (part2 - part1) * Math.pow(10, (2 - i) * 2);
    }

    return 0;
}
