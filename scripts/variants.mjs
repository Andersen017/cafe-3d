export function elementInVariant(element,variant){return !element.variant || element.variant===variant;}
export function includedElements(data,variant){return data.elements.filter(e=>elementInVariant(e,variant));}
export function variantById(data,id){return data.variants.options.find(v=>v.id===id) || data.variants.options.find(v=>v.id===data.variants.default);}
