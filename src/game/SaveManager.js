import Genome from '../genetics/Genome'
import axios from 'axios'
import { pool } from '../genetics/Pool'

class SaveManager {
  getLoadState = () => {
    this.getPreviousSaves().then(saves => {
      if (!saves.length) {
        pool.init()
      } else {
        this.loadFile(saves[0])
      }
    })
  }

  loadFile(file) {
    axios.get(file).then(
      res => {
        const poolJson = res.data
        this.hydrate(poolJson)
      },
      rej => {
        console.log(rej)
        pool.init()
      }
    )
  }

  hydrate(poolJson) {
    Object.assign(pool, poolJson)

    //Re Hydrate the genomes
    pool.genomes = pool.genomes.map(genome => {
      const hydratedGenome = Object.assign(new Genome(), genome)
      hydratedGenome.hydrateNetwork()
      return hydratedGenome
    })
  }

  getPreviousSaves() {
    return axios.get('/listsaves').then(
      res => res.data,
      rej => {
        console.log(rej)
        pool.init()
      }
    )
  }

  saveState(pool) {
    axios.post('/savestate', pool)
  }
}

export const saveManager = new SaveManager()
