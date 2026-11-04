# Builds the timeline as plain data: used by the timeline page, frozen into
# TimelineVersion snapshots, and included (as context) in the sealed capsule.
class TimelineSnapshot
  include Rails.application.routes.url_helpers

  def initialize(fellow)
    @fellow = fellow
  end

  def to_h
    f = @fellow
    eras = f.eras.to_a
    {
      format: "sondage-timeline/0.1",
      generatedAt: Time.current.iso8601,
      fellow: { name: f.display_name, birthYear: f.birth_year, birthPlace: f.birth_place },
      eras: eras.map { |e| { id: e.id, title: e.title, startYear: e.start_year, endYear: e.end_year, summary: e.summary, tone: e.tone } },
      events: f.events.includes(:added_by).map { |ev| event_h(ev, eras) },
      items: f.items.includes(:added_by, :event, file_attachment: :blob).map { |it| item_h(it, eras) },
      tenByTen: f.ten_by_ten_lists.includes(:entries).map { |l| { category: l.category, title: l.title, entries: l.entries.select { |e| e.title.present? }.map { |e| { rank: e.rank, title: e.title, note: e.note, year: e.year } } } },
      capsules: f.capsules.order(:sealed_at).map { |c| { capsuleId: c.capsule_uuid, manifestSha256: c.manifest_sha256, sealedAt: c.sealed_at.iso8601, title: c.meeting.title } }
    }
  end

  private

  def era_id(year, eras) = eras.find { |e| e.covers?(year) }&.id

  def event_h(ev, eras)
    {
      id: ev.id, title: ev.title, year: ev.year, month: ev.month, when: ev.when_label, place: ev.place_name,
      story: ev.story, eraId: era_id(ev.year, eras), addedBy: ev.added_by&.name, stageAdded: ev.stage_added,
      capsuleMomentSeconds: ev.capsule_moment_seconds
    }
  end

  def item_h(it, eras)
    year = it.year_for_timeline
    {
      id: it.id, kind: it.kind, source: it.source, title: it.title, caption: it.caption, year:, when: it.when_label,
      creator: it.creator, publication: it.publication, url: it.url, archiveUrl: it.archive_url, isrc: it.isrc,
      place: it.place_name, latitude: it.latitude&.to_f, longitude: it.longitude&.to_f,
      eventId: it.event_id, eraId: era_id(year, eras), addedBy: it.added_by&.name, stageAdded: it.stage_added,
      image: (rails_blob_path(it.file, only_path: true) if it.file.attached? && it.file.content_type.to_s.start_with?("image/")),
      fileUrl: (rails_blob_path(it.file, only_path: true) if it.file.attached?)
    }
  end
end
