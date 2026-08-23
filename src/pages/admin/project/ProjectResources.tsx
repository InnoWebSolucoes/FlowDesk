import React from 'react'
import { useOutletContext } from 'react-router-dom'
import { Project } from '../../../types'
import { ResourceCanvas } from '../../../components/resources/ResourceCanvas'

interface Ctx { project: Project }

export function ProjectResources() {
  const { project } = useOutletContext<Ctx>()

  return (
    <div>
      <p className="text-text-muted text-sm mb-4">
        Two fingers to pan, pinch to zoom. Zoom into a cluster to enter it, zoom back out to leave.
        Drag to arrange, drop an item onto a cluster to file it there, and double-click to open.
      </p>
      <ResourceCanvas projectId={project.id} />
    </div>
  )
}
