const { Readable } = require("stream")
const { finished } = require("stream/promises")
const fs = require("fs")
const gunzip = require("gunzip-file")

function wait(ms) {
  return new Promise(r => setTimeout(r, ms))
}

class E621Requester {
  static BASE_URL = "https://e621.net"
  static USER_AGENT = "E621 Advanced Search/1.0 (by DefinitelyNotAFurry4)"

  constructor(utils) {
    this.queue = []
    this.utilities = utils
    this.updated = 0
  }

  async processQueue() {
    let item = this.queue.shift()
    try {
      // let headers = {}
      // if (config.login.username != "" && config.login.apiKey != "") {
      //   headers.Authorization = `Basic ${btoa(`${config.login.username}:${config.login.apiKey}`)}`
      // }

      let res = await fetch(E621Requester.BASE_URL + `/${item.url}&_client=${E621Requester.USER_AGENT}`)

      if (res.status == 501) {
        // Sometimes this can just happen, all this will do is cancel whatever is going on without any extra text
        item.onReject({ e621Moment: true })
      } else if (res.ok) {
        item.onResolve(await res.json())
      } else {
        item.onReject({ code: res.status, url: E621Requester.BASE_URL + `/${path}&_client=${E621Requester.USER_AGENT}`, text: await res.text() })
      }
    } catch (e) {
      item.onReject({ code: 500, url: "Fetch failed" })
    }

    if (this.queue.length > 0) {
      await wait(1050)
      this.processQueue()
    }
  }

  addUrlToQueue(url) {
    return new Promise((resolve, reject) => {
      this.queue.push({
        url, onResolve: function () {
          resolve(...arguments)
        }, onReject: function () {
          reject(...arguments)
        }
      })

      if (this.queue.length == 1) {
        this.processQueue()
      }
    })
  }

  async addNewPosts() {
    let newPosts = []
    let updatedPosts = []

    try {
      let latestPostId = await this.utilities.getLatestPostId()
      console.log(`Adding posts after ${latestPostId}`)
      let data = await this.addUrlToQueue(`posts.json?tags=status:anylimit=320&page=a${latestPostId}`)

      for (let post of data.posts) {
        if (!post.hasOwnProperty("id") ||
          !post.hasOwnProperty("file") ||
          !post.hasOwnProperty("preview") ||
          !post.hasOwnProperty("created_at") ||
          !post.hasOwnProperty("score") ||
          !post.hasOwnProperty("tags")) continue

        let newPost = await this.utilities.createPost(post.id, post.tags, post.uploader_id, post.approver_id, post.created_at, post.updated_at,
          post.file.md5, post.sources, post.rating, post.file.width, post.file.height, post.duration || 0, post.fav_count, post.score.total,
          post.relationships.parent_id, post.relationships.children, post.file.ext, post.file.size, post.comment_count, post.flags.deleted,
          post.flags.pending, post.flags.flagged, post.flags.rating_locked, post.flags.status_locked, post.flags.note_locked)

        let existingPost = await this.utilities.getPost(post.id)

        if (!existingPost) {
          await this.utilities.addPost(newPost)

          newPosts.push(newPost)
        } else if (new Date(existingPost.updatedAt).getTime() != newPost.updatedAt.getTime()) {
          await this.utilities.updatePost(newPost)

          updatedPosts.push(newPost)
        }
      }

      if (data.posts.length >= 320) await this.addNewPosts()
    } catch (e) {
      console.error(e)

      if (e.e621Moment == true || e.code == 500) {
        return false
      }
    }

    if (newPosts.length > 0 && updatedPosts.length > 0) {
      this.utilities.postNewAndUpdatedPosts(newPosts, updatedPosts)
    } else if (newPosts.length > 0 && updatedPosts.length == 0) {
      this.utilities.postNewPosts(newPosts)
    } else if (updatedPosts.length > 0 && newPosts.length == 0) {
      this.utilities.postUpdatedPosts(updatedPosts)
    }
  }

  async checkForMisses(page = 1, endPageWithNoUpdates = 5) {
    let newPosts = []
    let updatedPosts = []

    try {
      let data = await this.addUrlToQueue(`posts.json?tags=order:change%20status:any&limit=320&page=${page}`)

      let anyUpdated = page < endPageWithNoUpdates

      let ids = []

      for (let post of data.posts) {
        if (!post.hasOwnProperty("id") ||
          !post.hasOwnProperty("file") ||
          !post.hasOwnProperty("preview") ||
          !post.hasOwnProperty("created_at") ||
          !post.hasOwnProperty("score") ||
          !post.hasOwnProperty("tags")) continue

        ids.push(post.id)
      }

      let existingPosts = await this.utilities.getPostsWithIds(ids)

      let promises = []

      let batch = { update: [], create: [] }

      for (let existingPost of existingPosts) {
        promises.push(new Promise(async (resolve) => {
          let post = data.posts.splice(data.posts.findIndex(_p => _p.id == existingPost.id), 1)[0]

          let p = await this.utilities.createPost(post.id, post.tags, post.uploader_id, post.approver_id, post.created_at, post.updated_at,
            post.file.md5, post.sources, post.rating, post.file.width, post.file.height, post.duration || 0, post.fav_count, post.score.total,
            post.relationships.parent_id, post.relationships.children, post.file.ext, post.file.size, post.comment_count, post.flags.deleted,
            post.flags.pending, post.flags.flagged, post.flags.rating_locked, post.flags.status_locked, post.flags.note_locked)

          if (p.isDeleted != existingPost.isDeleted || p.isFlagged != existingPost.isFlagged || p.isPending != existingPost.isPending || p.md5 != existingPost.md5) {
            console.log(`Updating missed post: ${post.id}`)

            anyUpdated = true

            batch.update.push(p)

            updatedPosts.push(p)
          }

          resolve()
        }))
      }

      if (data.posts.length > 0) {
        anyUpdated = true
      }

      for (let post of data.posts) {
        promises.push(new Promise(async (resolve) => {
          let p = await this.utilities.createPost(post.id, post.tags, post.uploader_id, post.approver_id, post.created_at, post.updated_at,
            post.file.md5, post.sources, post.rating, post.file.width, post.file.height, post.duration || 0, post.fav_count, post.score.total,
            post.relationships.parent_id, post.relationships.children, post.file.ext, post.file.size, post.comment_count, post.flags.deleted,
            post.flags.pending, post.flags.flagged, post.flags.rating_locked, post.flags.status_locked, post.flags.note_locked)

          console.log(`Adding missed post: ${post.id}`)

          batch.create.push(p)

          newPosts.push(p)

          resolve()
        }))
      }

      await Promise.all(promises)

      await this.utilities.bulkUpdateOrAddPosts(batch)

      if (anyUpdated && page < 750) {
        // console.log(`Continuing to next page of misses: ${page + 1}`)
        await this.checkForMisses(page + 1)
      }
    } catch (e) {
      console.error(e)

      if (e.e621Moment == true || e.code == 500) {
        return false
      }
    }

    if (newPosts.length > 0 && updatedPosts.length > 0) {
      this.utilities.postNewAndUpdatedPosts(newPosts, updatedPosts)
    } else if (newPosts.length > 0 && updatedPosts.length == 0) {
      this.utilities.postNewPosts(newPosts)
    } else if (updatedPosts.length > 0 && newPosts.length == 0) {
      this.utilities.postUpdatedPosts(updatedPosts)
    }
  }

  async applyUpdates(page = 1, endPageWithNoUpdates = 5) {
    let updatedPosts = []

    try {
      let anyUpdated = page < endPageWithNoUpdates

      let data = await this.addUrlToQueue(`posts.json?tags=order:updated_desc%20status:any&limit=320&page=${page}`)

      let ids = []

      for (let post of data.posts) {
        if (!post.hasOwnProperty("id") ||
          !post.hasOwnProperty("file") ||
          !post.hasOwnProperty("preview") ||
          !post.hasOwnProperty("created_at") ||
          !post.hasOwnProperty("score") ||
          !post.hasOwnProperty("tags")) continue

        ids.push(post.id)
      }

      let existingPosts = await this.utilities.getPostsWithIds(ids)

      let promises = []

      let batch = []

      for (let existingPost of existingPosts) {
        promises.push(new Promise(async (resolve) => {
          let post = data.posts.find(_p => _p.id == existingPost.id)

          if (new Date(existingPost.updatedAt).getTime() != new Date(post.updated_at).getTime()) {
            let p = await this.utilities.createPost(post.id, post.tags, post.uploader_id, post.approver_id, post.created_at, post.updated_at,
              post.file.md5, post.sources, post.rating, post.file.width, post.file.height, post.duration || 0, post.fav_count, post.score.total,
              post.relationships.parent_id, post.relationships.children, post.file.ext, post.file.size, post.comment_count, post.flags.deleted,
              post.flags.pending, post.flags.flagged, post.flags.rating_locked, post.flags.status_locked, post.flags.note_locked)

            this.updated++
            anyUpdated = true

            updatedPosts.push(p)

            batch.push(p)
          }

          resolve()
        }))
      }

      await Promise.all(promises)

      await this.utilities.bulkUpdatePosts(batch)

      if (anyUpdated && page < 750) {
        // console.log(`Applying next page of updates: ${page + 1}`)
        await this.applyUpdates(page + 1)
      }
    } catch (e) {
      console.error(e)

      if (e.e621Moment == true || e.code == 500) {
        return false
      }
    }

    if (updatedPosts.length > 0) {
      this.utilities.postUpdatedPosts(updatedPosts)
    }
  }

  async updateTagAliases(page = 1, endPageWithNoUpdates = 5) {
    try {
      let data = await this.addUrlToQueue(`tag_aliases.json?search%5Border%5D=updated_at&limit=100&page=${page}`)

      let anyUpdated = page < endPageWithNoUpdates

      if (data.tag_aliases) return

      for (let tagAlias of data) {
        let existingTagAlias = await this.utilities.getTagAlias(tagAlias.id)

        if (existingTagAlias && new Date(existingTagAlias.updatedAt) >= new Date(tagAlias.updated_at)) {
          continue
        }

        if (tagAlias.status == "active") {
          anyUpdated = true
          let usedTag = await this.utilities.getOrAddTag(tagAlias.consequent_name)

          if (!usedTag) {
            console.error(`Unable to add tag alias: ${tagAlias.antecedent_name} -> ${tagAlias.consequent_name}`)
            continue
          }

          if (!existingTagAlias) {
            anyUpdated = true
            await this.utilities.addTagAlias({ id: tagAlias.id, antecedentName: tagAlias.antecedent_name, consequentId: usedTag.id, updatedAt: new Date(tagAlias.updated_at) })
          } else if (existingTagAlias.antecedentName != tagAlias.antecedent_name || existingTagAlias.consequentId != usedTag.id) {
            anyUpdated = true
            await this.utilities.updateTagAlias({ id: tagAlias.id, antecedentName: tagAlias.antecedent_name, consequentId: usedTag.id, updatedAt: new Date(tagAlias.updated_at) })
          }
        } else {
          if (existingTagAlias) {
            anyUpdated = true
            await this.utilities.deleteTagAlias(tagAlias.id)
          }
        }
      }

      if (anyUpdated && page < 750) await this.updateTagAliases(++page)
    } catch (e) {
      console.error(e)

      if (e.e621Moment == true || e.code == 500) {
        return false
      }
    }
  }

  async updateTagImplications(page = 1, endPageWithNoUpdates = 5) {
    try {
      let data = await this.addUrlToQueue(`tag_implications.json?search%5Border%5D=updated_at&limit=100&page=${page}`)

      let anyUpdated = page < endPageWithNoUpdates

      if (data.tag_implications) return

      for (let tagImplication of data) {
        let existingTagImplication = await this.utilities.getTagImplication(tagImplication.id)

        if (existingTagImplication && new Date(existingTagImplication.updatedAt) >= new Date(tagImplication.updated_at)) {
          continue
        }

        if (tagImplication.status == "active") {

          let child = await this.utilities.getOrAddTag(tagImplication.antecedent_name)
          let parent = await this.utilities.getOrAddTag(tagImplication.consequent_name)

          if (!child || !parent) {
            console.error(`Unable to add tag implication: ${tagImplication.antecedent_name} -> ${tagImplication.consequent_name} (${!child} | ${!parent})`)
            continue
          }

          if (!existingTagImplication) {
            anyUpdated = true
            await this.utilities.addTagImplication({ id: tagImplication.id, antecedentId: child.id, consequentId: parent.id, updatedAt: new Date(tagImplication.updated_at) })
          } else if (existingTagImplication.antecedentId != child.id || existingTagImplication.consequentId != parent.id) {
            anyUpdated = true
            await this.utilities.updateTagImplication({ id: tagImplication.id, antecedentId: child.id, consequentId: parent.id, updatedAt: new Date(tagImplication.updated_at) })
          }
        } else {
          if (existingTagImplication) {
            anyUpdated = true
            await this.utilities.deleteTagImplication(tagImplication.id)
          }
        }
      }

      if (anyUpdated && page < 750) await this.updateTagImplications(++page)
    } catch (e) {
      console.error(e)

      if (e.e621Moment == true || e.code == 500) {
        return false
      }
    }
  }

  async updateTagImplication(tagName) {
    try {
      let data = await this.addUrlToQueue(`tag_implications.json?search%5Border%5D=updated_at&&search%5Bname_matches%5D=${tagName}`)

      if (data.tag_implications) return

      for (let tagImplication of data) {
        let existingTagImplication = await this.utilities.getTagImplication(tagImplication.id)

        if (existingTagImplication && new Date(existingTagImplication.updatedAt) >= new Date(tagImplication.updated_at)) {
          continue
        }

        if (tagImplication.status == "active") {

          let child = await this.utilities.getOrAddTag(tagImplication.antecedent_name)
          let parent = await this.utilities.getOrAddTag(tagImplication.consequent_name)

          if (!child || !parent) {
            console.error(`Unable to add tag implication: ${tagImplication.antecedent_name} -> ${tagImplication.consequent_name} (${!child} | ${!parent})`)
            continue
          }

          if (!existingTagImplication) {
            anyUpdated = true
            await this.utilities.addTagImplication({ id: tagImplication.id, antecedentId: child.id, consequentId: parent.id, updatedAt: new Date(tagImplication.updated_at) })
          } else if (existingTagImplication.antecedentId != child.id || existingTagImplication.consequentId != parent.id) {
            anyUpdated = true
            await this.utilities.updateTagImplication({ id: tagImplication.id, antecedentId: child.id, consequentId: parent.id, updatedAt: new Date(tagImplication.updated_at) })
          }
        } else {
          if (existingTagImplication) {
            anyUpdated = true
            await this.utilities.deleteTagImplication(tagImplication.id)
          }
        }
      }

      if (anyUpdated && page < 750) await this.updateTagImplications(++page)
    } catch (e) {
      console.error(e)

      if (e.e621Moment == true || e.code == 500) {
        return false
      }
    }
  }

  async updateTags(page = 1, endPageWithNoUpdates = 5) {
    try {
      let data = await this.addUrlToQueue(`tag_type_versions.json?limit=100&page=${page}`)

      let anyUpdated = page < endPageWithNoUpdates

      if (data.tags) return

      for (let tag of data) {
        let existingTag = await this.utilities.getTag(tag.tag_id)

        if (existingTag && new Date(existingTag.updatedAt) >= new Date(tag.updated_at)) {
          continue
        }

        let newTag = await this.getTagById(tag.tag_id)

        anyUpdated = true
        if (existingTag) await this.utilities.updateTag(newTag)
        else await this.utilities.addTag(newTag)
      }

      if (anyUpdated && page < 750) await this.updateTags(++page)
    } catch (e) {
      console.error(e)

      if (e.e621Moment == true || e.code == 500) {
        return false
      }
    }
  }

  async updateTag(tagName) {
    try {
      let data = await this.addUrlToQueue(`tags.json?search%5Border%5D=updated_at&search%5Bhide_empty%5D=0&search%5Bname_matches%5D=${tagName}`)

      if (data.tags) return

      for (let tag of data) {
        let existingTag = await this.utilities.getTag(tag.id)

        if (existingTag && new Date(existingTag.updatedAt) >= new Date(tag.updated_at)) {
          continue
        }

        if (tag.post_count != 0) {
          if (existingTag) await this.utilities.updateTag({ id: tag.id, name: tag.name, category: tag.category, postCount: tag.post_count, updatedAt: new Date(tag.updated_at) })
          else await this.utilities.addTag({ id: tag.id, name: tag.name, category: tag.category, postCount: tag.post_count, updatedAt: new Date(tag.updated_at) })
        } else {
          if (existingTag) {
            anyUpdated = true
            await this.utilities.deleteTag(tag.id)
          }
        }
      }
    } catch (e) {
      console.error(e)

      if (e.e621Moment == true || e.code == 500) {
        return false
      }
    }
  }

  async getTag(tagName) {
    try {
      console.log(`Getting new tag: "${tagName}"`)
      // let d = await this.utilities.getTagByName(tagName)
      // if (d) return d
      let data = await this.addUrlToQueue(`tags.json?limit=1&search[name_matches]=${encodeURIComponent(tagName)}&search%5Bhide_empty%5D=0`)
      if (data && data[0]) {
        return { id: data[0].id, name: data[0].name, category: data[0].category, postCount: data[0].post_count, updatedAt: new Date(data[0].updated_at) }
      } else {
        return null
      }
    } catch (e) {
      if (e.code == 404) {
        console.error(`Tag not found: ${tagName}`)
      } else {
        console.error(e)
      }
    }
  }

  async getTagById(id) {
    try {
      console.log(`Getting new tag by id: ${id}`)
      // let d = await this.utilities.getTagByName(tagName)
      // if (d) return d
      let data = await this.addUrlToQueue(`tags.json?limit=1&search[id]=${id}&search%5Bhide_empty%5D=0`)
      if (data && data[0]) {
        return { id: data[0].id, name: data[0].name, category: data[0].category, postCount: data[0].post_count, updatedAt: new Date(data[0].updated_at) }
      } else {
        console.error(`Tag not found: ${id}`)
        return null
      }
    } catch (e) {
      if (e.code == 404) {
        console.error(`Tag not found: ${id}`)
      } else {
        console.error(e)
      }
    }
  }

  async updateArtists(page = 1, endPageWithNoUpdates = 5) {
    try {
      let data = await this.addUrlToQueue(`artists.json?search%5Border%5D=updated_at&limit=100&page=${page}`)

      let anyUpdated = page < endPageWithNoUpdates

      if (!data || !data[0]) return

      for (let artist of data) {
        let existingArtist = await this.utilities.getArtist(artist.id)

        if (existingArtist && existingArtist.updatedAt >= new Date(artist.updated_at)) {
          continue
        }

        artist._id = artist.id
        delete artist.id

        artist.updatedAt = new Date(artist.updated_at)
        delete artist.updated_at

        artist.createdAt = new Date(artist.created_at)
        delete artist.created_at

        for (let i = 0; i < artist.urls.length; i++) {
          artist.urls[i].updatedAt = new Date(artist.urls[i].updated_at)
          delete artist.urls[i].updated_at

          artist.urls[i].createdAt = new Date(artist.urls[i].created_at)
          delete artist.urls[i].created_at
        }

        if (!existingArtist) {
          anyUpdated = true
          await this.utilities.addArtist(artist)
        } else {
          anyUpdated = true
          await this.utilities.updateArtist(artist)
        }
      }

      if (anyUpdated && page < 750) await this.updateArtists(++page)
    } catch (e) {
      console.error(e)

      if (e.e621Moment == true || e.code == 500) {
        return false
      }
    }
  }

  async fetchArtistsAfter(id) {
    try {
      let data = await this.addUrlToQueue(`artists.json?limit=320${id ? `&page=b${id}` : ""}`)
      let artists = []

      if (data && data[0]) {
        for (let artist of data) {
          artist._id = artist.id
          delete artist.id

          artist.updatedAt = new Date(artist.updated_at)
          delete artist.updated_at

          artist.createdAt = new Date(artist.created_at)
          delete artist.created_at

          for (let i = 0; i < artist.urls.length; i++) {
            artist.urls[i].updatedAt = new Date(artist.urls[i].updated_at)
            delete artist.urls[i].updated_at

            artist.urls[i].createdAt = new Date(artist.urls[i].created_at)
            delete artist.urls[i].created_at
          }

          artists.push(artist)
        }
      }

      return artists
    } catch (e) {
      console.error(e)
    }

    return []
  }

  async* fetchAllArtists() {
    let lastId = null
    while (true) {
      console.log(`Last id: ${lastId}`)
      let artists = await this.fetchArtistsAfter(lastId)
      if (artists.length == 0) {
        break
      }
      yield artists;
      lastId = artists[artists.length - 1]._id
    }
  }

  getDatabaseExport(exportName) {
    return new Promise(async (resolve, reject) => {
      if (fs.existsSync(`./${exportName.slice(0, -3)}`))
        return resolve(fs.createReadStream(`./${exportName.slice(0, -3)}`, { encoding: "utf-8" }))

      let res = await fetch(`https://e621.net/db_export/${exportName}`)
      if (res.ok) {
        const fileStream = fs.createWriteStream(`./${exportName}`, { flags: 'wx' })
        await finished(Readable.fromWeb(res.body).pipe(fileStream))
        gunzip(`./${exportName}`, `./${exportName.slice(0, -3)}`, () => {
          fs.rmSync(`./${exportName}`)
          resolve(fs.createReadStream(`./${exportName.slice(0, -3)}`, { encoding: "utf-8" }))
        })
      } else {
        reject({ code: res.status, text: await res.text() })
      }
    })
  }
}

module.exports = E621Requester