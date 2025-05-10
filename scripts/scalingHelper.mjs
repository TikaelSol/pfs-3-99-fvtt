// import { scenarioDefinitionFiles } from '../scenarioDefinitions/scenarioFileList.mjs';

const moduleId = 'pfs-3-99-fate-in-the-future';

// dynamically import the scenario definition data, storing everything in the 'scenarioDefinitions' variable
var scenarioDefinitions = [];
// for (let filename of scenarioDefinitionFiles) {
//   await import(`../scenarioDefinitions/${filename}`)
//     .then((module) => {
//       scenarioDefinitions.push({
//         data: module.default,
//         label: module.default.scenarioLabel,
//       });
//     })
//     .catch((error) => console.log(error));
// }

// a couple helper functions for making adjustments to actors
/* let healToFull = async (actor) => {
  const actualMaxHp = token.actor.system.attributes.hp.max;
  const hpAdjustment = {
    actorData: { system: { attributes: { hp: { value: actualMaxHp } } } },
  };
  await token.update(hpAdjustment);
};
let adjustMaxHp = async (token, hpAdjustment) => {
  const actualMaxHp = token.actor.system.attributes.hp.base;
  const adjustment = {
    actorData: {
      system: { attributes: { hp: { max: actualMaxHp + hpAdjustment } } },
    },
  };
  await token.update(adjustment);
}; */

export async function scalingHelper() {
  let selection = {};

  let setSelection = async (html) => {
    var scenarioLabel = html[0].querySelector('#scenario option:checked').value;
    selection = scenarioDefinitions.find((s) => s.label == scenarioLabel).data;
  };

  var content =
    scenarioDefinitions.reduce((acc, s) => {
      return acc + `<option value="${s.label}">${s.label}</option>`;
    }, `<label for="scenario">Choose a Scenario:</label><select name="scenario" id="scenario">`) + '</select>';
  console.log(content);

  //  const scenarioButtons = scenarioDefinitions.map((s) => ({
  //    label: s.label,
  //    callback: async () => {
  //      selection = s.data;
  //    },
  //  }));
  await Dialog.wait({
    title: 'Scenario Selection',
    content: content,
    buttons: {
      ok: { label: 'OK', callback: (html) => setSelection(html) },
      cancel: { label: 'Cancel' },
    },
  });
  console.log('selection ', selection);

  content = `${selection.scalingOptions.reduce((acc, s) => {
    return acc + `<input type="radio" value="${s.tier}" name="tier"><label>${s.tier}</label><br>`;
  }, '<form>')}
    <hr><label for="cp">Challenge Points:</label><input type="number" id="cp" name="cp" min="8" max="36" length="2" value="8" required></input>
    </form>`;

  console.log(content);

  await Dialog.wait({
    title: 'Scaling Selection',
    content: content,
    buttons: {
      ok: { label: 'OK', callback: (html) => doIt(html, selection) },
      cancel: { label: 'Cancel' },
    },
  });
}

async function doIt(html, selection) {
  const scaling = { cp: 0, tier: '' };
  for (var opt of selection.scalingOptions) {
    if (html[0].querySelector(`[type="radio"][value="${opt.tier}"]`).checked) {
      scaling.tier = opt.tier;
      scaling.cp = Number(html[0].querySelector('#cp').value);
    }
  }
  console.log('scaling ', scaling);
  // rudimentary input verification
  if (scaling.tier == undefined || scaling.tier == '' || scaling.cp == undefined) {
    ui.notifications.error('Please choose a level range and enter a Challenge Points value.');
    return;
  }
  for (var opt of selection.scalingOptions) {
    if (opt.tier == scaling.tier) {
      if (scaling.cp < opt.cpMin || scaling.cp > opt.cpMax) {
        ui.notifications.error(
          `The specified Challenge Points (${scaling.cp}) is not in range for levels ${scaling.tier} (${opt.cpMin} - ${opt.cpMax})`
        );
        return;
      }
    }
  }
  // set up the CSS to only show the relevant tier of information
  const additionalCssClass = [
    `journal-tier${scaling.tier}`,
    `journal-party-${scaling.number_of_pcs == 4 ? 'four' : scaling.number_of_pcs == 5 ? 'five' : 'six'}`,
  ].join(' ');
  console.log('TNT200 | css ', additionalCssClass);
  JournalEntry.updateDocuments(
    selection.journalEntries.map((j) => ({
      _id: j,
      'flags.tnt-pfs0200-assets.tier': additionalCssClass,
    }))
  );

  // Clear all Combats, GMs always forget that
  Combat.deleteDocuments(game.combats.map((c) => c.id));

  // Prepare to place player tokens on the maps
  var playerTokenInfo = null;
  var playerMinX = null;
  var playerMinY = null;
  if (canvas.tokens.controlled.length == 0) {
    // it's legit to not select player tokens. Log a console message to show we recognized it.
    console.log('No tokens selected for player placement.');
  } else {
    const currentSceneDPI = canvas.scene.dimensions.size;
    playerTokenInfo = canvas.tokens.controlled.map((t) => ({
      actorID: t.actor._id,
      w: t.hitArea.width / currentSceneDPI,
      h: t.hitArea.height / currentSceneDPI,
      x: t.position.x,
      y: t.position.y,
    }));
    // Find the upper left point of the selected tokens
    playerMinX = canvas.scene.dimensions.width;
    playerMinY = canvas.scene.dimensions.height;
    for (const token of playerTokenInfo) {
      if (token.x < playerMinX) {
        playerMinX = token.x;
      }
      if (token.y < playerMinY) {
        playerMinY = token.y;
      }
    }

    // convert player token x,y into relative grid-sized coordinates
    for (const token of playerTokenInfo) {
      token.x = (token.x - playerMinX) / currentSceneDPI;
      token.y = (token.y - playerMinY) / currentSceneDPI;
    }
  }

  // place all the tokens
  var feedbackDialog = new Dialog({
    title: 'Scenario Scaling and Token Placement',
    content: '',
    buttons: { cancel: { label: 'CLOSE' } },
  });

  var sceneCounter = 0;
  for (const sceneData of selection.scenes) {
    //    console.log(sceneData);
    sceneCounter++;
    feedbackDialog.data.content = `<p>Scaling ${sceneData.data.name}</p><br/><progress id="progress" max="${selection.scenes.length}" value="${sceneCounter}"></progress>`;
    await feedbackDialog.render(true);

    const scene = game.scenes.get(sceneData.id);
    if (scene) {
      // Clear all tokens
      await scene.deleteEmbeddedDocuments(
        'Token',
        scene.tokens.map((t) => t.id)
      );

      // Rename Scene for the scenario
      await scene.update(sceneData.data);

      // Create array of tokens to place
      const tokenDatas = [];

      // add players to our array of tokens
      var newSceneDPI = scene.dimensions.size;
      if (playerTokenInfo && sceneData.playerStartX) {
        for (const token of playerTokenInfo) {
          let actor = await game.actors.get(token.actorID);
          let actorData = {
            x: token.x * newSceneDPI + sceneData.playerStartX,
            y: token.y * newSceneDPI + sceneData.playerStartY,
            hidden: false,
          };
          //          console.log(actor);
          tokenDatas.push(await actor.getTokenDocument(actorData));
        }
      }

      // add NPC tokens to the array
      console.log(scaling.tier, scaling.cp);
      const scalingData = sceneData.scaling.filter((s) => s.tier == scaling.tier && s.cp.includes(scaling.cp));
      if (!!scalingData.length) {
        for (const tokenSpec of scalingData.flatMap((s) => s.tokens)) {
          let actor = game.actors.get(tokenSpec.actorId);
          if (!actor) {
            actor = game.actors.getName(tokenSpec.actorName);
          }
          if (!actor) {
          } else {
            for (const tokenSetup of tokenSpec.data) {
              const tokenDocument = await actor.getTokenDocument(tokenSetup);
              const tokenData = tokenDocument.toObject();
              if (tokenSetup?.texture && Object.hasOwn(tokenSetup.texture, 'src')) {
                tokenData.texture.src = `modules/${moduleId}/${tokenSetup.texture.src}`;
              }
              tokenDatas.push(tokenData);
            }
          }
        }
      }
      // if no player tokens were selected, and the scene does not have any scaling defined,
      // we might not have anything to place
      if (tokenDatas) {
        await scene.createEmbeddedDocuments('Token', tokenDatas);
        await new Promise((res) => setTimeout(res, 500));
        for (const token of scene.tokens) {
          if (token.flags?.['pfs-3-99-fate-in-the-future']?.conditions) {
            for (const condition of token.flags?.['pfs-3-99-fate-in-the-future']?.conditions) {
              await token.actor.toggleCondition(condition);
            }
          }
          if (token.flags?.['pfs-3-99-fate-in-the-future']?.adjustments) {
            if (token.flags?.['pfs-3-99-fate-in-the-future']?.adjustments.includes('elite')) {
              await token.actor.applyAdjustment('elite');
            }
            if (token.flags?.['pfs-3-99-fate-in-the-future']?.adjustments.includes('weak')) {
              await token.actor.applyAdjustment('weak');
            }
          }
          if (token.flags?.['pfs-3-99-fate-in-the-future']?.items) {
            const items = [];
            for (const item of token.flags?.['pfs-3-99-fate-in-the-future']?.items) {
              items.push(await fromUuid(item));
            }
            await token.actor.createEmbeddedDocuments('Item', items);
          }
          if (token.flags?.['pfs-3-99-fate-in-the-future']?.max) {
            if (/^[+-]/.test(token.flags['pfs-3-99-fate-in-the-future'].max)) {
              await token.actor.update(
                {
                  'system.attributes.hp.max':
                    token.actor.system.attributes.hp.max + Number(token.flags['pfs-3-99-fate-in-the-future'].hp),
                  'system.attributes.hp.value':
                    token.actor.system.attributes.hp.value + Number(token.flags['pfs-3-99-fate-in-the-future'].hp),
                },
                { allowHPOverage: true }
              );
            } else {
              await token.actor.update(
                {
                  'system.attributes.hp.max': Number(token.flags['pfs-3-99-fate-in-the-future'].max),
                  'system.attributes.hp.value': Number(token.flags['pfs-3-99-fate-in-the-future'].max),
                },
                { allowHPOverage: true }
              );
            }
          } else if (token.flags?.['pfs-3-99-fate-in-the-future']?.hp) {
            if (/^[+-]/.test(token.flags['pfs-3-99-fate-in-the-future'].hp)) {
              await token.actor.update({
                'system.attributes.hp.value':
                  token.actor.system.attributes.hp.value + Number(token.flags['pfs-3-99-fate-in-the-future'].hp),
              });
            } else {
              await token.actor.update({
                'system.attributes.hp.value': Number(token.flags['pfs-3-99-fate-in-the-future'].hp),
              });
            }
          }
          if (token.flags?.['pfs-3-99-fate-in-the-future']?.elevation) {
            await token.update({ elevation: token.flags['pfs-3-99-fate-in-the-future'].elevation });
          }
          if (token.flags?.['pfs-3-99-fate-in-the-future']?.toggleRollOption) {
            const { domain, option, itemId, value, suboption } =
              token.flags['pfs-3-99-fate-in-the-future'].toggleRollOption;
            await token.actor.toggleRollOption(domain, option, itemId, value, suboption);
          }
        }
      }
    }
  }
  feedbackDialog.data.content = `<p>${selection.scenes.length} scenes prepared.</p>`;
  await feedbackDialog.render(true);
}
