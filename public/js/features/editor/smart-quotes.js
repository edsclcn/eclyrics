(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.eclyricsSmartQuotes = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const LEADING_APOSTROPHE_WORDS = new Set([
        'bout',
        'cause',
        'di',
        'em',
        'fore',
        'gain',
        'neath',
        'n',
        'round',
        'tis',
        'til',
        'twas',
        'to',
        'wag',
        'yan',
        'yo',
        'yon',
        'yong',
        'yung',
    ]);
    const DOUBLE_QUOTE_VARIANTS = '"“”„‟＂';

    const isWordCharacter = (value) => /[\p{L}\p{N}]/u.test(value || '');
    const isOpeningPunctuation = (value) => /[([{|—–\-:;]/.test(value || '');

    function getFollowingWord(text, quoteIndex) {
        return text.slice(quoteIndex + 1).match(/^[\p{L}\p{N}]+/u)?.[0].toLowerCase() || '';
    }

    function isOpeningSingleQuote(text, index) {
        const previous = text[index - 1] || '';
        const next = text[index + 1] || '';
        if (!next || /\s/.test(next) || isWordCharacter(previous)) return false;
        return index === 0 || /\s/.test(previous) || isOpeningPunctuation(previous);
    }

    function isApostrophe(text, index) {
        const previous = text[index - 1] || '';
        const next = text[index + 1] || '';
        const followingWord = getFollowingWord(text, index);

        // Internal contractions: may’rong, ika’y, h‘wag.
        if (isWordCharacter(previous) && isWordCharacter(next)) return true;

        // Possessives or trailing apostrophes: James’, ’tis.
        if (isWordCharacter(previous) && (!next || /[\s.,!?;:)}\]]/.test(next))) return true;

        // Filipino/English clipped words at the beginning of a word: ’di, ’wag, ’to.
        return (
            isWordCharacter(next) &&
            LEADING_APOSTROPHE_WORDS.has(followingWord) &&
            (index === 0 || /\s/.test(previous) || isOpeningPunctuation(previous))
        );
    }

    function isOpeningDoubleQuote(text, index) {
        const previous = text[index - 1] || '';
        const next = text[index + 1] || '';
        if (!next || /\s/.test(next) || isWordCharacter(previous)) return false;
        return index === 0 || /\s/.test(previous) || isOpeningPunctuation(previous);
    }

    function normalizeSmartQuotes(value) {
        return String(value == null ? '' : value).replace(/[\u0022\u201c\u201d\u201e\u201f\uff02'‘’‚‛＇]/g, (quote, index, text) => {
            if (DOUBLE_QUOTE_VARIANTS.includes(quote)) {
                return isOpeningDoubleQuote(text, index) ? '“' : '”';
            }
            if (isApostrophe(text, index)) return '’';
            return isOpeningSingleQuote(text, index) ? '‘' : '’';
        });
    }

    return { normalizeSmartQuotes };
});
