import { scalingHelper } from './scalingHelper.mjs';

const apTitle = 'Timi PF2e PFS 06-00';
const apSlug = apTitle.replaceAll(/[^0-9a-zA-Z]/g, '');
console.log(`Timi PFS4 | setting up scaler for ${apSlug}`);
window.scalingHelper = window.scalingHelper ?? {};
window.scalingHelper[`${apSlug.toLowerCase()}`] = {
  scalingHelper,
};

// Import macro is one simple mysterious line
// window.scalingHelper['timisf2epfs04'].scalingHelper()

Hooks.once('init', () => {
  DocumentSheetConfig.registerSheet(Adventure, 'pfs-3-99-fate-in-the-future', DrentalPF2EAdventureImporter, {
    label: `PFS 3-99 Adventure Importer`,
    makeDefault: false,
  });

  DocumentSheetConfig.registerSheet(JournalEntry, 'pfs-3-99-fate-in-the-future', DrentalPF2EJournalSheet, {
    type: 'base',
    makeDefault: false,
    canBeDefault: false,
    label: `PFS 3-99 Asset Pack Journal`,
  });

  DocumentSheetConfig.registerSheet(JournalEntryPage, 'pfs-3-99-fate-in-the-future', DrentalPF2EJournalSheetPage, {
    type: 'text',
    makeDefault: false,
    canBeDefault: false,
    label: `PFS 3-99 Asset Pack Journal Page`,
  });
});

class DrentalPF2EJournalSheet extends JournalSheet {
  static get defaultOptions() {
    const overrides = {
      classes: ['sheet', 'journal-sheet', 'journal-entry', `6-00-wrapper`],
      width: window.innerWidth < 800 ? 720 : 960,
      height: window.innerHeight < 1000 ? 700 : 800,
    };
    return foundry.utils.mergeObject(super.defaultOptions, overrides);
  }

  getData(options) {
    const data = super.getData(options);
    if (this?.document?.flags['pfs-3-99-fate-in-the-future']?.tier) {
      data.cssClass += ` ${this.document.flags['pfs-3-99-fate-in-the-future'].tier}`;
    }
    return data;
  }
}

class DrentalPF2EJournalSheetPage extends JournalTextPageSheet {
  async showWhisperDialog(doc, content) {
    if (!(doc instanceof JournalEntry || doc instanceof JournalEntryPage)) return;
    if (!doc.isOwner)
      return ui.notifications.error('JOURNAL.ShowBadPermissions', {
        localize: true,
      });
    const { DialogV2 } = foundry.applications.api;

    return await DialogV2.wait({
      window: { title: 'Send Read-aloud' },
      content: 'Do you want to send this text to chat?',
      buttons: [
        {
          label: 'Yes',
          action: 'send-read-aloud',
          callback: () => {
            return ChatMessage.create({
              content: content,
            });
          },
        },
        {
          label: 'No',
        },
      ],
      rejectClose: false,
      default: 'send-read-aloud',
    });
  }

  async _onClickReadAloud(event) {
    event.preventDefault();
    if (['IMG', 'A'].includes(event.target.tagName)) return;
    const el = event.currentTarget;
    const readAloudHTML = `<div data-chatable>${el.innerHTML}</div>`;
    // const journal = new JournalEntry();
    this.showWhisperDialog(this.object.parent, readAloudHTML);
  }

  activateListeners(html) {
    super.activateListeners(html);
    html.find('.read-aloud').click(this._onClickReadAloud.bind(this));
  }
}

class DrentalPF2EAdventureImporter extends AdventureImporter {
  /**
   *  Add adventure stuff
   *
   * @param {Adventure} adventure
   * @param {object} options
   */
  constructor(adventure, options) {
    super(adventure, options);
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  async getData(options = {}) {
    const data = await super.getData();
    return data;
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  activateListeners(html) {
    super.activateListeners(html);
  }

  /* -------------------------------------------- */

  /**
   * Prepare a list of content types provided by this adventure.
   *
   * @returns {{icon: string, label: string, count: number}[]}
   * @protected
   */
  _getContentList() {
    return Object.entries(Adventure.contentFields).reduce((arr, [field, cls]) => {
      const count = this.adventure[field].size;
      if (!count) return arr;
      arr.push({
        field,
        icon: CONFIG[cls.documentName].sidebarIcon,
        label: game.i18n.localize(count > 1 ? cls.metadata.labelPlural : cls.metadata.label),
        count,
      });
      return arr;
    }, []);
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  async _prepareImportData(formData) {
    this.submitOptions = formData;
    const { toCreate, toUpdate, documentCount } = await super._prepareImportData(formData);
    if ('Actor' in toCreate) await this.#mergeCompendiumActors(toCreate.Actor);
    if ('Actor' in toUpdate) await this.#mergeCompendiumActors(toUpdate.Actor);
    return { toCreate, toUpdate, documentCount };
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  async _importContent(toCreate, toUpdate, documentCount) {
    const importResult = await super._importContent(toCreate, toUpdate, documentCount);
    game.user.assignHotbarMacro(game.macros.get('63IYHLn4rrzmf1aP'), 1, {});
    return importResult;
  }

  /* -------------------------------------------- */

  /**
   * Merge Actor data with authoritative source data from system compendium packs
   *
   * @param {Actor[]} actors        Actor documents intended to be imported
   * @param {object} importOptions  Form submission import options
   * @returns {Promise<void>}
   */
  async #mergeCompendiumActors(actors) {
    for (let actor of actors) {
      const uuid = actor._stats?.compendiumSource;
      const source = await fromUuid(uuid);
      if (!source && uuid) {
        console.warn(
          `Compendium source data for "${actor.name}" [${actor._id}] not found in pack ${uuid.split('.')[1]}`
        );
      }
      const sourceData = source.toObject();

      if (source.type === 'npc') {
        actor = Object.assign(
          actor,
          foundry.utils.mergeObject(sourceData, {
            folder: actor.folder,
            img: actor.img,
            items: items,
            name: actor.name,
            'prototypeToken.name': actor.prototypeToken?.name,
            'prototypeToken.texture': actor.prototypeToken?.texture,
            'prototypeToken.randomImg': actor.prototypeToken?.randomImg,
            'prototypeToken.flags.pf2e': actor.prototypeToken?.flags?.pf2e,
            'system.attributes.adjustment': actor.system.attributes?.adjustment,
            'system.details.blurb': actor.system.details?.blurb,
            'system.attributes.hp.value': actor.system.attributes?.hp?.value,
            'system.details.languages.value': actor.system.details?.languages?.value,
            'system.traits.value': actor.system.traits?.value,
            'system.traits.size': actor.system.traits?.size,
            _id: actor._id,
          })
        );
      }
      if (source.type === 'hazard') {
        actor = Object.assign(
          actor,
          foundry.utils.mergeObject(sourceData, {
            folder: actor.folder,
            img: actor.img,
            items: items,
            name: actor.name,
            'prototypeToken.name': actor.prototypeToken?.name,
            'prototypeToken.texture': actor.prototypeToken?.texture,
            'prototypeToken.width': actor.prototypeToken?.width,
            'prototypeToken.height': actor.prototypeToken?.height,
            'system.traits.value': actor.system.traits?.value,
            _id: actor._id,
          })
        );
      }
      if (source.type === 'vehicle') {
        actor = Object.assign(
          actor,
          foundry.utils.mergeObject(sourceData, {
            folder: actor.folder,
            img: actor.img,
            items: items,
            name: actor.name,
            'prototypeToken.name': actor.prototypeToken?.name,
            'prototypeToken.texture': actor.prototypeToken?.texture,
            'prototypeToken.width': actor.prototypeToken?.width,
            'prototypeToken.height': actor.prototypeToken?.height,
            _id: actor._id,
          })
        );
      }
    }
  }
}
