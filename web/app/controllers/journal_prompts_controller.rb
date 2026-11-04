# Questions the historian or an admin leaves in the Fellow's journal.
class JournalPromptsController < ApplicationController
  before_action :set_fellow

  def create
    return head(:forbidden) unless current_user.admin? || (current_user.historian? && current_user.can_see?(@fellow))
    prompt = @fellow.journal_prompts.build(text: params.require(:journal_prompt)[:text], author: current_user)
    if prompt.save
      audit("journal.prompt_added", subject: prompt)
      redirect_to fellow_journal_entries_path(@fellow), notice: "Your question is in #{@fellow.display_name.split.first}'s journal."
    else
      redirect_to fellow_journal_entries_path(@fellow), alert: prompt.errors.full_messages.to_sentence
    end
  end

  # The Fellow can set a question aside; its author can take it back.
  def destroy
    prompt = @fellow.journal_prompts.find(params[:id])
    if @fellow.user_id == current_user.id
      prompt.update!(dismissed_at: Time.current)
    elsif prompt.author_id == current_user.id || current_user.admin?
      prompt.destroy!
    else
      return head(:forbidden)
    end
    redirect_to fellow_journal_entries_path(@fellow)
  end
end
