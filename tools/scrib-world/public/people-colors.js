"use strict";
// Class names, never user CSS or inline styles: compatible with the strict CSP.
window.ScribPeopleColors = (() => {
  const palette = [
    ['rose','Rosa coral','#ff8094'],['peach','Melocotón','#ff9d72'],['amber','Ámbar','#ffb956'],
    ['gold','Dorado','#eacb6f'],['citron','Limón','#dcd97b'],['pistachio','Pistacho','#badb7a'],
    ['mint','Menta','#8bde9c'],['jade','Jade','#71d7b5'],['turquoise','Turquesa','#64dcca'],
    ['cyan','Cian','#64dee7'],['sky','Cielo','#73cfea'],['azure','Azul claro','#84bef5'],
    ['periwinkle','Azul lavanda','#93b1ff'],['violet','Violeta','#a89cfc'],['lilac','Lila','#b69af2'],
    ['orchid','Orquídea','#cd96e5'],['fuchsia','Fucsia suave','#e196dc'],['pink','Rosa','#f792ca'],
    ['salmon','Salmón','#fa99ad'],['lavender','Lavanda','#cec0ff'],['ice','Azul hielo','#a9d6ff'],
    ['seafoam','Verde agua','#98dbc6'],['sand','Arena','#d5ca9e'],['clay','Arcilla','#dec2bd']
  ];
  const options = Object.freeze({auto:'Automático · estable por persona',...Object.fromEntries(palette.map(([key,label])=>[key,label]))});
  function key(person) {
    if(!person)return 'neutral';
    if(person.color !== 'auto' && palette.some(([key])=>key===person.color))return person.color;
    // UUID, not name/team/list order, so renaming or moving someone keeps the color.
    let hash=2166136261;
    for(const ch of String(person.id || person.name || 'new'))hash=Math.imul(hash ^ ch.charCodeAt(0),16777619)>>>0;
    return palette[hash % palette.length][0];
  }
  const className=person=>'person-colored person-tone-'+key(person);
  function decorate(node,person) {
    for(const c of [...node.classList])if(c.startsWith('person-tone-'))node.classList.remove(c);
    node.classList.add('person-colored','person-tone-'+key(person));
  }
  return {palette,options,key,className,decorate};
})();
