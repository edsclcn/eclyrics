const SYMBOL = '§';
const validChars = [
    'r', 'g', 'b', 'y', 'v', 'f', 'z', 'n', 'i', 'u', 's'
];
const closeTag = '</span>';

function italicizePromptText(line) {
    return line.replace(/\([^()\r\n]*\)|\b(?:Instrumental|Interlude)\b/gi, '<em>$&</em>');
}

function formatText(text) {
    if (!text) return '';
    const normalizedText = window.eclyricsSmartQuotes?.normalizeSmartQuotes?.(text) || text;
    let lines = normalizedText.split('\n');

    for (let i = 0; i < lines.length; i++) {
        let line = italicizePromptText(lines[i]);
        if (!line || !line.includes(SYMBOL)) {
            lines[i] = line;
            continue;
        }

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

    return lines.join('\n');
}
