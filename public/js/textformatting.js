const SYMBOL = '§';
const validChars = [
    'r', 'g', 'b', 'y', 'v', 'f', 'z', 'n', 'i', 'u', 's'
];
const closeTag = '</span>';

function formatText(text) {
    if (!text) return '';
    let lines = text.split('\n');

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        if (!line || !line.includes(SYMBOL)) continue;

        let formattedLine = '';
        let openTags = [];

        for (let j = 0; j < line.length; j++) {
            if (line[j] === SYMBOL && j + 1 < line.length) {
                let char = line[j + 1];
                if (validChars.includes(char)) {
                    if (char === 's') {
                        while (openTags.length) {
                            formattedLine += closeTag;
                            openTags.pop();
                        }
                    } else {
                        formattedLine += `<span class="${char}">`;
                        openTags.push(char);
                    }
                    j++;
                    continue;
                }
            }
            formattedLine += line[j];
        }

        while (openTags.length) {
            formattedLine += closeTag;
            openTags.pop();
        }

        lines[i] = formattedLine;
    }

    console.log(lines.join('\n'));
    return lines.join('\n');
}
