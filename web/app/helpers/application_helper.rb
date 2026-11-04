module ApplicationHelper
  # A top-bar link; the page you're on is shown as [ LINK ].
  def nav_link(label, path)
    here = current_page?(path) || (path != root_path && path != match_path && request.path.start_with?("#{path}/"))
    link_to label, path, class: ("active" if here), "aria-current": ("page" if here)
  end

  # A script from public/sondage, at a path that changes whenever the scripts change.
  def sondage_script_tag(name)
    # If the versioned copy can't load for any reason, fall back to the plain file.
    fallback = "if(!this.dataset.retried){this.dataset.retried=1;var s=document.createElement('script');s.type='module';s.src='/sondage/#{name}?t='+Date.now();document.body.appendChild(s);console.warn('Sondage: loading /sondage/#{name} directly')}"
    tag.script(type: "module", src: "/sondage/v/#{SondageScriptsController.version}/#{name}", onerror: fallback)
  end

  def page_title(text = nil)
    content_for(:title, text) if text
    [ content_for(:title).presence, "Sondage" ].compact.join(" · ")
  end

  def stage_steps(fellow)
    Fellow::STAGES.each_with_index.map do |stage, i|
      state = i < fellow.stage_index ? "done" : i == fellow.stage_index ? "current" : "todo"
      tag.li(Fellow::STAGE_LABELS[stage], class: state)
    end.join.html_safe
  end

  # Plain words for Fellows; the admin pages keep the working names.
  FELLOW_STAGE_WORDS = { "intake" => "Questions", "ten_by_ten" => "10x10 talk", "refining" => "Photos and stories", "interview" => "Interview", "delivered" => "Done" }.freeze

  def fellow_stage_steps(fellow)
    Fellow::STAGES.each_with_index.map do |stage, i|
      state = i < fellow.stage_index ? "done" : i == fellow.stage_index ? "current" : "todo"
      tag.li(FELLOW_STAGE_WORDS[stage], class: state)
    end.join.html_safe
  end

  def when_label(time) = time ? l(time, format: "%A, %B %-d, %Y at %-l:%M %p") : "Not scheduled"

  def source_label(item)
    item.source == "own" ? "From #{item.fellow.display_name}'s collection" : "Added for context#{" by #{item.added_by.name}" if item.added_by}"
  end

  def kind_label(kind) = { "photo" => "Photograph", "article" => "Article", "song" => "Song", "letter" => "Letter", "document" => "Document", "place" => "Place" }.fetch(kind, kind.humanize)

  def error_summary(record)
    return unless record.errors.any?
    tag.div(class: "error") { tag.p("Please fix the following:") + tag.ul(safe_join(record.errors.full_messages.map { |m| tag.li(m) })) }
  end
end
