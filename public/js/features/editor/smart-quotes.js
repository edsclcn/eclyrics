(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.eclyricsSmartQuotes = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const isWordCharacter = (value) => /[\p{L}\p{N}]/u.test(value || '');
    const isOpeningPunctuation = (value) => /[([{|—–\-:;]/.test(value || '');

    function isOpeningDoubleQuote(text, index) {
        const previous = text[index - 1] || '';
        const next = text[index + 1] || '';
        if (!next || /\s/.test(next) || isWordCharacter(previous)) return false;
        return index === 0 || /\s/.test(previous) || isOpeningPunctuation(previous);
    }

    function normalizeSmartQuotes(value) {
        const text = String(value == null ? '' : value)
            .replace(/['‘’‚‛＇ʼʻˈ\u0060]/g, '’');

        return text.replace(/[\u0022\u201c\u201d\u201e\u201f\uff02]/g, (quote, index, source) => {
            return isOpeningDoubleQuote(source, index) ? '“' : '”';
        });
    }

    return { normalizeSmartQuotes };
});
